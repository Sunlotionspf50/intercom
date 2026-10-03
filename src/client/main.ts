import "./styles.css";

interface SessionResponse {
  armed: boolean;
  expiresAt: number;
}

interface ApiError {
  error?: string;
}

const ACCESS_WINDOW_MS = 2 * 60 * 1000;
const SESSION_CHECK_INTERVAL_MS = 2_000;

const loginForm = required<HTMLFormElement>("login-form");
const accessCode = required<HTMLInputElement>("access-code");
const loginButton = required<HTMLButtonElement>("login-button");
const timerLabel = required("timer-label");
const sessionTime = required<HTMLTimeElement>("session-time");
const message = required("message");

let expiresAt = 0;
let expiryTimer: number | undefined;
let clockTimer: number | undefined;
let sessionMonitorTimer: number | undefined;
let sessionCheckInFlight = false;
let doorEventShown = false;

function required<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as unknown as T;
}

function showMessage(text = ""): void {
  message.textContent = text;
  message.hidden = !text;
}

async function responseBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function stopTimers(): void {
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
  if (sessionMonitorTimer !== undefined) window.clearInterval(sessionMonitorTimer);
  expiryTimer = undefined;
  clockTimer = undefined;
  sessionMonitorTimer = undefined;
}

function setReadyState(): void {
  timerLabel.textContent = "Ready";
  sessionTime.textContent = "--:--";
  sessionTime.dateTime = "PT0S";
}

function updateClock(): void {
  const remaining = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  timerLabel.textContent = "Active";
  sessionTime.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  sessionTime.dateTime = `PT${Math.ceil(remaining / 1000)}S`;
}

function startSessionTimers(nextExpiry: number): void {
  stopTimers();
  expiresAt = nextExpiry;
  doorEventShown = false;
  updateClock();
  clockTimer = window.setInterval(updateClock, 1000);
  expiryTimer = window.setTimeout(() => void expireSession(), Math.max(0, expiresAt - Date.now()));
  sessionMonitorTimer = window.setInterval(() => void verifySession(), SESSION_CHECK_INTERVAL_MS);
}

async function verifySession(): Promise<void> {
  if (sessionCheckInFlight || !expiresAt) return;
  sessionCheckInFlight = true;
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) {
      if (Date.now() < expiresAt - SESSION_CHECK_INTERVAL_MS) {
        showDoorOpened();
      } else {
        await endSession("The access window expired.");
      }
    }
  } catch {
    // A temporary network failure should not interrupt an active timer.
  } finally {
    sessionCheckInFlight = false;
  }
}

async function endSession(reason: string): Promise<void> {
  stopTimers();
  expiresAt = 0;
  setReadyState();
  await fetch("/api/session", { method: "DELETE", keepalive: true }).catch(() => undefined);
  showMessage(reason);
  accessCode.value = "";
  accessCode.focus();
}

function showDoorOpened(): void {
  if (doorEventShown) return;
  doorEventShown = true;
  stopTimers();
  expiresAt = 0;
  timerLabel.textContent = "Opened";
  sessionTime.textContent = "00:00";
  sessionTime.dateTime = "PT0S";
  showMessage("Door opened.");
  window.setTimeout(() => {
    setReadyState();
    showMessage();
    accessCode.value = "";
    accessCode.focus();
  }, 2_300);
}

async function expireSession(): Promise<void> {
  await endSession("The access window expired.");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  showMessage();
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: accessCode.value }),
    });
    const body = await responseBody<SessionResponse & ApiError>(response);
    if (!response.ok) {
      showMessage(body.error ?? "Incorrect access code.");
      accessCode.select();
      return;
    }
    accessCode.value = "";
    startSessionTimers(body.expiresAt);
  } catch {
    showMessage("The app could not reach the server.");
  } finally {
    loginButton.disabled = false;
  }
});

async function restoreSession(): Promise<void> {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) {
      setReadyState();
      accessCode.focus();
      return;
    }
    const body = await responseBody<SessionResponse>(response);
    accessCode.value = "";
    startSessionTimers(body.expiresAt);
  } catch {
    setReadyState();
    showMessage("The app could not reach the server.");
  }
}

void restoreSession();
