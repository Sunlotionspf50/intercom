import JsSIP from "jssip";
import "./styles.css";

type ViewName = "login" | "waiting" | "incoming" | "connected";

interface SessionResponse {
  authenticated: boolean;
  expiresAt: number;
}

interface PhoneConfig {
  username: string;
  password: string;
  uri: string;
  websocketUrl: string;
  expiresAt: number;
}

interface ApiError {
  error?: string;
}

const views: Record<ViewName, HTMLElement> = {
  login: required("login-view"),
  waiting: required("waiting-view"),
  incoming: required("incoming-view"),
  connected: required("connected-view"),
};
const loginForm = required<HTMLFormElement>("login-form");
const accessCode = required<HTMLInputElement>("access-code");
const loginButton = required<HTMLButtonElement>("login-button");
const answerButton = required<HTMLButtonElement>("answer-button");
const openButton = required<HTMLButtonElement>("open-button");
const soundButton = required<HTMLButtonElement>("sound-button");
const hangupButton = required<HTMLButtonElement>("hangup-button");
const waitingStatus = required("waiting-status");
const callStatus = required("call-status");
const sessionTime = required<HTMLTimeElement>("session-time");
const message = required("message");
const remoteAudio = required<HTMLAudioElement>("remote-audio");

let userAgent: any = null;
let call: any = null;
let expiresAt = 0;
let expiryTimer: number | undefined;
let clockTimer: number | undefined;
let connectionPollTimer: number | undefined;
let audioPollTimer: number | undefined;
let finishingCall = false;

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function showView(name: ViewName): void {
  for (const [viewName, element] of Object.entries(views)) {
    element.hidden = viewName !== name;
  }
}

function showMessage(text = ""): void {
  message.textContent = text;
  message.hidden = !text;
}

async function responseBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function recordEvent(event: string): Promise<void> {
  try {
    await fetch("/api/security-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    });
  } catch {
    // Logging must never stop call controls from working.
  }
}

function stopTimers(): void {
  if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
  expiryTimer = undefined;
  clockTimer = undefined;
}

function stopCallTimers(): void {
  if (connectionPollTimer !== undefined) window.clearInterval(connectionPollTimer);
  if (audioPollTimer !== undefined) window.clearInterval(audioPollTimer);
  connectionPollTimer = undefined;
  audioPollTimer = undefined;
}

function updateClock(): void {
  const remaining = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  sessionTime.textContent = `${minutes}:${seconds.toString().padStart(2, "0")} remaining`;
  sessionTime.dateTime = `PT${Math.ceil(remaining / 1000)}S`;
}

function startSessionTimers(nextExpiry: number): void {
  stopTimers();
  expiresAt = nextExpiry;
  updateClock();
  clockTimer = window.setInterval(updateClock, 1000);
  expiryTimer = window.setTimeout(() => void expireSession(), Math.max(0, expiresAt - Date.now()));
}

function stopPhone(): void {
  stopCallTimers();
  const activeCall = call;
  call = null;
  remoteAudio.pause();
  remoteAudio.srcObject = null;
  soundButton.hidden = true;
  if (activeCall && !activeCall.isEnded()) {
    try {
      activeCall.terminate();
    } catch {
      // The provider may already have ended the call.
    }
  }
  if (userAgent) {
    try {
      userAgent.stop();
    } catch {
      // Stopping an already disconnected agent is harmless.
    }
  }
  userAgent = null;
}

async function endBrowserSession(reason: string): Promise<void> {
  stopTimers();
  stopPhone();
  expiresAt = 0;
  sessionTime.textContent = "Not active";
  await fetch("/api/session", { method: "DELETE", keepalive: true }).catch(() => undefined);
  showView("login");
  showMessage(reason);
  accessCode.value = "";
  accessCode.focus();
}

async function expireSession(): Promise<void> {
  stopPhone();
  await endBrowserSession("Your 30-minute session ended. Enter the code to listen again.");
}

async function playRemoteAudio(): Promise<void> {
  try {
    await remoteAudio.play();
    soundButton.hidden = true;
  } catch {
    soundButton.hidden = false;
    callStatus.textContent = "Tap Enable sound to hear the intercom.";
  }
}

function attachRemoteTrack(event: RTCTrackEvent): void {
  const stream = event.streams[0] ?? new MediaStream([event.track]);
  remoteAudio.srcObject = stream;
  remoteAudio.muted = false;
  remoteAudio.volume = 1;
  void playRemoteAudio();
}

function playReceiverTracks(): boolean {
  if (!call?.connection) return false;
  const tracks = call.connection
    .getReceivers()
    .map((receiver: RTCRtpReceiver) => receiver.track)
    .filter((track: MediaStreamTrack | null): track is MediaStreamTrack => track?.kind === "audio");
  if (tracks.length > 0) {
    remoteAudio.srcObject = new MediaStream(tracks);
    void playRemoteAudio();
    return true;
  }
  return false;
}

function markConnected(expectedCall: any): void {
  if (call !== expectedCall || finishingCall) return;
  if (!expectedCall.isEstablished()) return;
  if (connectionPollTimer !== undefined) window.clearInterval(connectionPollTimer);
  connectionPollTimer = undefined;
  openButton.disabled = false;
  callStatus.textContent = "You can speak now. If you cannot hear the intercom, enable sound.";
  soundButton.hidden = false;
  showView("connected");
  if (!playReceiverTracks()) {
    let attempts = 0;
    audioPollTimer = window.setInterval(() => {
      attempts += 1;
      if (playReceiverTracks() || attempts >= 40) {
        if (audioPollTimer !== undefined) window.clearInterval(audioPollTimer);
        audioPollTimer = undefined;
      }
    }, 250);
  }
}

function waitForConnection(expectedCall: any): void {
  stopCallTimers();
  let attempts = 0;
  const check = () => {
    if (call !== expectedCall || finishingCall) {
      stopCallTimers();
      return;
    }
    attempts += 1;
    if (expectedCall.isEstablished()) {
      markConnected(expectedCall);
    } else if (attempts >= 100) {
      if (connectionPollTimer !== undefined) window.clearInterval(connectionPollTimer);
      connectionPollTimer = undefined;
      callStatus.textContent = "The call was answered, but audio is still connecting.";
    }
  };
  check();
  if (!expectedCall.isEstablished()) connectionPollTimer = window.setInterval(check, 100);
}

async function finishCall(event: "call_remote_end" | "call_hangup", reason: string): Promise<void> {
  if (finishingCall) return;
  finishingCall = true;
  await recordEvent(event);
  await endBrowserSession(reason);
  finishingCall = false;
}

function watchIncomingCall(nextCall: any): void {
  if (call && !call.isEnded()) {
    nextCall.terminate({ status_code: 486, reason_phrase: "Busy" });
    return;
  }

  call = nextCall;
  stopCallTimers();
  finishingCall = false;
  answerButton.disabled = false;
  showMessage();
  showView("incoming");

  call.connection.addEventListener("track", attachRemoteTrack);
  call.connection.addEventListener("connectionstatechange", () => {
    if (call === nextCall && call.connection.connectionState === "connected") {
      waitForConnection(nextCall);
    }
  });
  call.on("accepted", () => markConnected(nextCall));
  call.on("confirmed", () => markConnected(nextCall));
  call.on("ended", () => {
    if (call === nextCall) void finishCall("call_remote_end", "The call ended. Enter the code to listen again.");
  });
  call.on("failed", (event: { cause?: string }) => {
    if (call === nextCall) {
      void finishCall(
        "call_remote_end",
        `The call ended${event.cause ? `: ${event.cause}` : ""}. Enter the code to listen again.`,
      );
    }
  });
}

async function connectPhone(nextExpiry: number): Promise<void> {
  showView("waiting");
  showMessage();
  waitingStatus.textContent = "Connecting to the handset…";
  startSessionTimers(nextExpiry);

  const response = await fetch("/api/phone-config", { cache: "no-store" });
  if (!response.ok) {
    await endBrowserSession("Your session could not be started. Please try again.");
    return;
  }
  const config = await responseBody<PhoneConfig>(response);
  startSessionTimers(config.expiresAt);

  const socket = new JsSIP.WebSocketInterface(config.websocketUrl);
  userAgent = new JsSIP.UA({
    sockets: [socket],
    uri: config.uri,
    password: config.password,
    authorization_user: config.username,
  });

  userAgent.on("connected", () => {
    waitingStatus.textContent = "Registering the handset…";
  });
  userAgent.on("registered", () => {
    waitingStatus.textContent = "Ready. Waiting for the intercom to call.";
  });
  userAgent.on("registrationFailed", (event: { cause?: string }) => {
    void endBrowserSession(
      `The handset could not register${event.cause ? `: ${event.cause}` : ""}. Check the provider settings.`,
    );
  });
  userAgent.on("disconnected", () => {
    if (!finishingCall && views.waiting.hidden === false) {
      waitingStatus.textContent = "Connection lost. Trying to reconnect…";
    }
  });
  userAgent.on("newRTCSession", (event: { originator: string; session: any }) => {
    if (event.originator === "remote") watchIncomingCall(event.session);
  });
  userAgent.start();
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
      showMessage(body.error ?? "The access code could not be checked.");
      accessCode.select();
      return;
    }
    accessCode.value = "";
    await connectPhone(body.expiresAt);
  } catch {
    showMessage("The app could not reach the server. Please try again.");
  } finally {
    loginButton.disabled = false;
  }
});

answerButton.addEventListener("click", () => {
  if (!call?.isInProgress()) return;
  answerButton.disabled = true;
  try {
    call.answer({ mediaConstraints: { audio: true, video: false } });
    openButton.disabled = true;
    soundButton.hidden = false;
    callStatus.textContent = "Connecting audio…";
    showView("connected");
    waitForConnection(call);
    void recordEvent("call_answered");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "microphone access failed";
    answerButton.disabled = false;
    showMessage(`Could not answer: ${detail}`);
  }
});

openButton.addEventListener("click", () => {
  if (!call?.isEstablished()) return;
  openButton.disabled = true;
  try {
    call.sendDTMF("5", { transportType: "INFO", duration: 200 });
    callStatus.textContent = "Door signal sent.";
    void recordEvent("door_open_requested");
  } catch (error) {
    callStatus.textContent = error instanceof Error ? error.message : "The door signal failed.";
  } finally {
    window.setTimeout(() => {
      openButton.disabled = false;
      if (callStatus.textContent === "Door signal sent.") callStatus.textContent = "You can speak now.";
    }, 1000);
  }
});

soundButton.addEventListener("click", () => {
  playReceiverTracks();
  void playRemoteAudio();
});

remoteAudio.addEventListener("playing", () => {
  soundButton.hidden = true;
  if (call?.isEstablished()) callStatus.textContent = "You can speak now.";
});

hangupButton.addEventListener("click", () => {
  if (!call) return;
  const activeCall = call;
  call = null;
  try {
    activeCall.terminate();
  } finally {
    void finishCall("call_hangup", "You ended the call. Enter the code to listen again.");
  }
});

window.addEventListener("pagehide", () => {
  stopPhone();
  if (expiresAt) void fetch("/api/session", { method: "DELETE", keepalive: true });
});

async function restoreSession(): Promise<void> {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) {
      showView("login");
      accessCode.focus();
      return;
    }
    const body = await responseBody<SessionResponse>(response);
    await connectPhone(body.expiresAt);
  } catch {
    showView("login");
    showMessage("The app could not reach the server.");
  }
}

void restoreSession();
