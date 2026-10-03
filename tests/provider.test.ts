import { describe, expect, it } from "vitest";
import {
  incomingCallAction,
  DOOR_SIGNAL_ACTION,
  providerAddressAllowed,
  validIncomingCall,
} from "../src/worker/provider";

describe("provider callback checks", () => {
  it("allows only a configured callback address", () => {
    const configured = "176.10.154.199, 2001:9b0:2:902::199";
    expect(providerAddressAllowed("176.10.154.199", configured)).toBe(true);
    expect(providerAddressAllowed("203.0.113.2", configured)).toBe(false);
  });

  it("requires an incoming call to the configured number with a call id", () => {
    const form = new URLSearchParams({
      direction: "incoming",
      to: "+46100000000",
      callid: "call-test",
    });
    expect(validIncomingCall(form, "+46100000000")).toBe(true);
    expect(validIncomingCall(form, "+46100000001")).toBe(false);
  });

  it("plays the door signal when an access window is active", () => {
    expect(incomingCallAction(true, "+46700000000")).toEqual({ play: DOOR_SIGNAL_ACTION });
  });

  it("routes to the owner phone when no access window is active", () => {
    expect(incomingCallAction(false, "+46700000000")).toEqual({ connect: "+46700000000" });
  });
});
