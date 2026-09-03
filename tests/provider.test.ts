import { describe, expect, it } from "vitest";
import {
  normalizeSipUri,
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

  it("normalizes the provider URI for JsSIP", () => {
    expect(normalizeSipUri("4600@example.com")).toBe("sip:4600@example.com");
    expect(normalizeSipUri("sip:4600@example.com")).toBe("sip:4600@example.com");
  });
});
