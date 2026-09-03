import { describe, expect, it } from "vitest";
import {
  evaluateLoginAttempt,
  matchesSecret,
  MAX_FAILED_ATTEMPTS,
  RATE_BLOCK_MS,
  readCookie,
} from "../src/worker/security";

describe("access-code comparison", () => {
  it("accepts only the configured code", async () => {
    await expect(matchesSecret("2468", "2468", "test-key")).resolves.toBe(true);
    await expect(matchesSecret("2469", "2468", "test-key")).resolves.toBe(false);
  });
});

describe("rate limiting", () => {
  it("blocks the fifth failed attempt for fifteen minutes", () => {
    const now = 10_000;
    let record = null;
    let decision;
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      decision = evaluateLoginAttempt(record, false, now + attempt);
      record = decision.record;
    }
    expect(decision?.allowed).toBe(false);
    expect(record?.blockedUntil).toBe(now + MAX_FAILED_ATTEMPTS - 1 + RATE_BLOCK_MS);
  });

  it("clears failures after a correct code", () => {
    const decision = evaluateLoginAttempt(
      { count: 3, windowStarted: 100, blockedUntil: 0 },
      true,
      200,
    );
    expect(decision).toEqual({ allowed: true, retryAfterSeconds: 0, record: null });
  });

  it("does not let a correct code bypass an active block", () => {
    const decision = evaluateLoginAttempt(
      { count: 5, windowStarted: 100, blockedUntil: 1_000 },
      true,
      500,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(1);
  });
});

describe("cookie parsing", () => {
  it("finds the opaque session token", () => {
    expect(readCookie("theme=light; intercom_session=abc-123; x=y", "intercom_session")).toBe(
      "abc-123",
    );
  });
});
