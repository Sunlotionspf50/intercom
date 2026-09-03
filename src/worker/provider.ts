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

export function normalizeSipUri(uri: string): string {
  return uri.startsWith("sip:") ? uri : `sip:${uri}`;
}
