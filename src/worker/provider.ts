export function providerAddressAllowed(address: string, configuredAddresses: string): boolean {
  const allowed = new Set(
    configuredAddresses
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  return allowed.has(address);
}

export function validIncomingCall(form: URLSearchParams, configuredNumber: string): boolean {
  return (
    form.get("direction") === "incoming" &&
    form.get("to") === configuredNumber &&
    Boolean(form.get("callid"))
  );
}

export const DOOR_SIGNAL_ACTION = "sound/dtmf/5";

export type IncomingCallAction =
  | { play: typeof DOOR_SIGNAL_ACTION }
  | { connect: string };

export function incomingCallAction(
  hasActiveAccessWindow: boolean,
  ownerPhoneNumber: string,
): IncomingCallAction {
  return hasActiveAccessWindow ? { play: DOOR_SIGNAL_ACTION } : { connect: ownerPhoneNumber };
}
