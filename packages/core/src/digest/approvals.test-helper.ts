import type { ApprovalView } from "../outgoing/sender";
import { textTables } from "../texts";

import { renderApprovalRequest } from "./approvals";

export const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

export const NOW = new Date("2026-11-07T10:00:00Z");

export const TZ = "Europe/Warsaw";

// eslint-disable-next-line no-control-regex -- the point is to find them
export const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

export function view(overrides: Partial<ApprovalView> = {}): ApprovalView {
  return {
    kind: "delegation",
    recipient: { name: "Anna Nowak", address: "anna@example.com" },
    sender: { label: "boss@client.test", external: true },
    recipientInactive: false,
    subject: "Fwd: Offer",
    dueDate: "2026-11-12",
    body: "Hi Anna,\n\nPlease check the offer.\n\nThanks",
    quote: { text: "> Hello\n> World", cut: false },
    synthetic: false,
    ...overrides,
  };
}

export function request(v: ApprovalView) {
  return renderApprovalRequest({ actionId: ID, view: v, now: NOW, timeZone: TZ }, textTables.en);
}

export const recipient = { name: "Anna Nowak", address: "anna@example.com" };
