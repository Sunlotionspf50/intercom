const encoder = new TextEncoder();

export const SESSION_LENGTH_MS = 30 * 60 * 1000;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const RATE_BLOCK_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;

export interface RateRecord {
  count: number;
  windowStarted: number;
  blockedUntil: number;
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  record: RateRecord | null;
}

export function evaluateLoginAttempt(
  current: RateRecord | null,
  isCorrect: boolean,
  now: number,
): RateDecision {
  if (current && current.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((current.blockedUntil - now) / 1000),
      record: current,
    };
  }

  if (isCorrect) {
    return { allowed: true, retryAfterSeconds: 0, record: null };
  }

  const withinWindow = current && now - current.windowStarted < RATE_WINDOW_MS;
  const count = withinWindow ? current.count + 1 : 1;
  const windowStarted = withinWindow ? current.windowStarted : now;
  const blockedUntil = count >= MAX_FAILED_ATTEMPTS ? now + RATE_BLOCK_MS : 0;

  return {
    allowed: false,
    retryAfterSeconds: blockedUntil ? Math.ceil(RATE_BLOCK_MS / 1000) : 0,
    record: { count, windowStarted, blockedUntil },
  };
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function matchesSecret(
  candidate: string,
  expected: string,
  comparisonKey: string,
): Promise<boolean> {
  const [candidateMac, expectedMac] = await Promise.all([
    hmac(comparisonKey, candidate),
    hmac(comparisonKey, expected),
  ]);

  let difference = candidateMac.length ^ expectedMac.length;
  const length = Math.max(candidateMac.length, expectedMac.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (candidateMac[index] ?? 0) ^ (expectedMac[index] ?? 0);
  }
  return difference === 0;
}

export async function keyedHash(secret: string, value: string): Promise<string> {
  const bytes = await hmac(secret, value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}
