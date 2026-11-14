// What happened in the Account card's two-factor flow that changes the "backup codes were not shown" warning.
export type FlowEvent =
  // The code check answered 500 and the status was read again; `enabled` is what that read says.
  | { type: "verify_failed_status"; enabled: boolean }
  | { type: "verified" }
  | { type: "turned_off" }
  | { type: "codes_made" };

// The warning stays only after a failed verify that left TOTP on. Every later step that shows codes or
// ends TOTP clears it, so it never outlives the state it described.
export function withoutCodesAfter(current: boolean, event: FlowEvent): boolean {
  if (event.type === "verify_failed_status") return event.enabled;
  return event.type === "verified" || event.type === "turned_off" || event.type === "codes_made" ? false : current;
}
