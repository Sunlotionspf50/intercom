import type { AuthState } from "./auth-state";
import { normalizeSipUri, providerAddressAllowed, validIncomingCall } from "./provider";
import {
  createSessionToken,
  keyedHash,
  matchesSecret,
  readCookie,
  SESSION_LENGTH_MS,
  sha256,
} from "./security";

export { AuthState } from "./auth-state";

interface Env {
  ASSETS: Fetcher;
  AUTH_STATE: DurableObjectNamespace<AuthState>;
  ACCESS_CODE: string;
  SESSION_SECRET: string;
  WEBRTC_USERNAME: string;
  WEBRTC_PASSWORD: string;
  WEBRTC_URI: string;
  WEBRTC_WEBSOCKET_URL: string;
  PROVIDER_PHONE_NUMBER: string;
  PROVIDER_WEBRTC_NUMBER: string;
  PROVIDER_CALLBACK_IPS: string;
}

type SecurityEvent =
  | "call_answered"
  | "door_open_requested"
  | "call_hangup"
  | "call_remote_end";

const COOKIE_NAME = "intercom_session";
const SECURITY_EVENTS = new Set<SecurityEvent>([
  "call_answered",
  "door_open_requested",
  "call_hangup",
  "call_remote_end",
]);

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...detail }));
}

function authState(env: Env): DurableObjectStub<AuthState> {
  return env.AUTH_STATE.getByName("global");
}

function sourceAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local-development";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function expiredCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_LENGTH_MS / 1000}`;
}

function requiredConfiguration(env: Env): string[] {
  const required: Array<keyof Env> = [
    "ACCESS_CODE",
    "SESSION_SECRET",
    "WEBRTC_USERNAME",
    "WEBRTC_PASSWORD",
    "WEBRTC_URI",
    "WEBRTC_WEBSOCKET_URL",
    "PROVIDER_PHONE_NUMBER",
    "PROVIDER_WEBRTC_NUMBER",
    "PROVIDER_CALLBACK_IPS",
  ];
  return required.filter((name) => !env[name]).map(String);
}

async function currentSession(
  request: Request,
  env: Env,
): Promise<{ tokenHash: string; expiresAt: number } | null> {
  const token = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const expiresAt = await authState(env).validateSession(tokenHash, Date.now());
  return expiresAt ? { tokenHash, expiresAt } : null;
}

async function createSession(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin" }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Enter the access code" }, 400);
  }
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : "";

  const ipHash = await keyedHash(env.SESSION_SECRET, sourceAddress(request));
  const isCorrect = await matchesSecret(code, env.ACCESS_CODE, env.SESSION_SECRET);
  const attempt = await authState(env).attemptLogin(ipHash, isCorrect, Date.now());

  if (!attempt.allowed) {
    const blocked = attempt.retryAfterSeconds > 0;
    log(blocked ? "auth_blocked" : "auth_failed", { source: ipHash.slice(0, 12) });
    return json(
      { error: blocked ? "Too many attempts. Try again in 15 minutes." : "Incorrect access code" },
      blocked ? 429 : 401,
      blocked ? { "Retry-After": String(attempt.retryAfterSeconds) } : {},
    );
  }

  const token = createSessionToken();
  const expiresAt = Date.now() + SESSION_LENGTH_MS;
  await authState(env).createSession(await sha256(token), expiresAt);
  log("session_created", { source: ipHash.slice(0, 12), expiresAt });
  return json(
    { authenticated: true, expiresAt },
    201,
    { "Set-Cookie": sessionCookie(token) },
  );
}

async function getSession(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) {
    return json(
      { authenticated: false },
      401,
      { "Set-Cookie": expiredCookie() },
    );
  }
  return json({ authenticated: true, expiresAt: session.expiresAt });
}

async function deleteSession(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin" }, 403);
  const suppliedToken = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  const session = await currentSession(request, env);
  if (session) {
    await authState(env).deleteSession(session.tokenHash);
    log("session_ended");
  } else if (suppliedToken) {
    log("session_expired");
  }
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": expiredCookie(), "Cache-Control": "no-store" },
  });
}

async function phoneConfig(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Session expired" }, 401);
  return json({
    username: env.WEBRTC_USERNAME,
    password: env.WEBRTC_PASSWORD,
    uri: normalizeSipUri(env.WEBRTC_URI),
    websocketUrl: env.WEBRTC_WEBSOCKET_URL,
    expiresAt: session.expiresAt,
  });
}

async function recordSecurityEvent(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin" }, 403);
  if (!(await currentSession(request, env))) return json({ error: "Session expired" }, 401);
  let body: { event?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid event" }, 400);
  }
  if (typeof body.event !== "string" || !SECURITY_EVENTS.has(body.event as SecurityEvent)) {
    return json({ error: "Invalid event" }, 400);
  }
  log(body.event);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

async function providerForm(request: Request): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) return null;
  return new URLSearchParams(await request.text());
}

async function incomingCall(request: Request, env: Env): Promise<Response> {
  if (!providerAddressAllowed(sourceAddress(request), env.PROVIDER_CALLBACK_IPS)) {
    log("provider_callback_rejected", { reason: "source" });
    return json({ error: "Forbidden" }, 403);
  }
  const form = await providerForm(request);
  if (
    !form ||
    !validIncomingCall(form, env.PROVIDER_PHONE_NUMBER)
  ) {
    log("provider_callback_rejected", { reason: "payload" });
    return json({ error: "Invalid callback" }, 400);
  }

  log("provider_call_received", { callId: form.get("callid") });
  const hangupUrl = new URL("/api/provider/hangup", request.url).toString();
  return json({ connect: env.PROVIDER_WEBRTC_NUMBER, whenhangup: hangupUrl });
}

async function providerHangup(request: Request, env: Env): Promise<Response> {
  if (!providerAddressAllowed(sourceAddress(request), env.PROVIDER_CALLBACK_IPS)) {
    log("provider_callback_rejected", { reason: "source" });
    return json({ error: "Forbidden" }, 403);
  }
  const form = await providerForm(request);
  if (!form || !form.get("id")) {
    log("provider_callback_rejected", { reason: "payload" });
    return json({ error: "Invalid callback" }, 400);
  }
  log("provider_call_ended", {
    callId: form.get("id"),
    state: form.get("state") ?? "unknown",
  });
  return new Response(null, { status: 204 });
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/session" && request.method === "POST") {
    return createSession(request, env);
  }
  if (url.pathname === "/api/session" && request.method === "GET") {
    return getSession(request, env);
  }
  if (url.pathname === "/api/session" && request.method === "DELETE") {
    return deleteSession(request, env);
  }
  if (url.pathname === "/api/phone-config" && request.method === "GET") {
    return phoneConfig(request, env);
  }
  if (url.pathname === "/api/security-events" && request.method === "POST") {
    return recordSecurityEvent(request, env);
  }
  if (url.pathname === "/api/provider/incoming" && request.method === "POST") {
    return incomingCall(request, env);
  }
  if (url.pathname === "/api/provider/hangup" && request.method === "POST") {
    return providerHangup(request, env);
  }
  return json({ error: "Not found" }, 404);
}

function withSecurityHeaders(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("X-Content-Type-Options", "nosniff");
  next.headers.set("Referrer-Policy", "no-referrer");
  next.headers.set("Permissions-Policy", "camera=(), geolocation=()");
  next.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' wss://voip.46elks.com ws://localhost:*; img-src 'self'; media-src 'self' blob:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  return next;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const missing = requiredConfiguration(env);
    if (missing.length > 0) {
      log("configuration_missing", { names: missing });
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    const url = new URL(request.url);
    const response = url.pathname.startsWith("/api/")
      ? await api(request, env)
      : await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  },
} satisfies ExportedHandler<Env>;
