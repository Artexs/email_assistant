import { describe, expect, test } from "bun:test";

import type { DraftPayload } from "../triage/payloads";

import { buildOutgoingMessage, type OriginalMail } from "./message";
import { QUOTE_PREVIEW_CHARS } from "./quote";
import { approvalViewOf, isExternalSender } from "./sender";

const ctx = { internalAddresses: ["b@interia.pl", "jan@firma.pl"], whitelisted: false, vip: false };

describe("isExternalSender", () => {
  test("treats a same-domain address that is not internal as external", () => {
    expect(isExternalSender("a@interia.pl", ctx)).toBe(true);
  });

  test("treats an internal address as not external, ignoring case and spaces", () => {
    expect(isExternalSender("b@interia.pl", ctx)).toBe(false);
    expect(isExternalSender("B@Interia.pl", ctx)).toBe(false);
    expect(isExternalSender("  b@interia.pl ", ctx)).toBe(false);
    expect(isExternalSender("jan@firma.pl", ctx)).toBe(false);
  });

  test("lower-cases the internal list", () => {
    expect(isExternalSender("b@interia.pl", { ...ctx, internalAddresses: ["B@Interia.PL"] })).toBe(false);
  });

  test("a whitelisted or VIP sender is not external", () => {
    expect(isExternalSender("x@evil.pl", { ...ctx, whitelisted: true })).toBe(false);
    expect(isExternalSender("x@evil.pl", { ...ctx, vip: true })).toBe(false);
  });

  test("a missing sender is external, even when whitelisted", () => {
    expect(isExternalSender(null, ctx)).toBe(true);
    expect(isExternalSender(null, { ...ctx, whitelisted: true, vip: true })).toBe(true);
  });

  test("an empty list makes every sender external", () => {
    expect(isExternalSender("b@interia.pl", { ...ctx, internalAddresses: [] })).toBe(true);
  });
});

const original: OriginalMail = {
  fromAddress: "klient@firma.pl",
  subject: "Oferta",
  receivedAt: new Date("2026-11-06T09:00:00Z"),
  messageId: "<orig@firma.pl>",
  inReplyTo: null,
  references: [],
  bodyText: Array.from({ length: 300 }, (_, i) => `line ${i} of the original`).join("\n"),
};

const delegation = {
  kind: "delegation",
  delegate_id: "22222222-2222-4222-8222-222222222222",
  delegate_name: "Jan",
  to: ["jan@firma.pl"],
  task: "Przygotuj ofertę",
  due_date: "2026-11-10",
  language: "pl",
} satisfies DraftPayload;

const reminder = {
  kind: "reminder",
  delegate_id: "22222222-2222-4222-8222-222222222222",
  delegate_name: "Jan",
  to: ["jan@firma.pl"],
  task: "Przygotuj ofertę",
  due_date: "",
  language: "pl",
  delegation_id: "33333333-3333-4333-8333-333333333333",
  reminder: 1,
  thread: { in_reply_to: "<a@x>", references: ["<a@x>"] },
} satisfies DraftPayload;

function build(draft: DraftPayload) {
  return buildOutgoingMessage({
    draft,
    draftActionId: "11111111-1111-4111-8111-111111111111",
    createdAt: new Date("2026-11-07T08:00:00Z"),
    mailbox: { address: "user@interia.pl" },
    owner: { displayName: "Artek" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    original,
  });
}

describe("approvalViewOf", () => {
  test("builds the view of a delegation message", () => {
    const message = build(delegation);
    const view = approvalViewOf(message, {
      draft: delegation,
      original,
      external: true,
      synthetic: false,
      recipientInactive: true,
    });
    expect(view.kind).toBe("delegation");
    expect(view.recipient).toEqual({ name: "Jan", address: "jan@firma.pl" });
    expect(view.sender).toEqual({ label: "klient@firma.pl", external: true });
    expect(view.recipientInactive).toBe(true);
    expect(view.synthetic).toBe(false);
    expect(view.subject).toBe("Fwd: Oferta");
    expect(view.dueDate).toBe("2026-11-10");
    expect(view.body).toBe(message.parts.body);
    expect(view.quote?.cut).toBe(true);
    expect(view.quote?.text.length).toBeLessThanOrEqual(QUOTE_PREVIEW_CHARS);
    expect(message.parts.quote).toStartWith(view.quote?.text ?? "?");
  });

  test("a reminder has no sender, no quote and no due date when empty", () => {
    const view = approvalViewOf(build(reminder), {
      draft: reminder,
      original,
      external: false,
      synthetic: true,
      recipientInactive: false,
    });
    expect(view.sender).toBeNull();
    expect(view.quote).toBeNull();
    expect(view.dueDate).toBeNull();
    expect(view.synthetic).toBe(true);
  });
});
