import { describe, expect, test } from "bun:test";

import type { DraftPayload } from "../triage/payloads";

import { buildOutgoingMessage, type OriginalMail } from "./message";
import { QUOTE_PREVIEW_CHARS } from "./quote";
import { approvalViewOf, isExternalSender } from "./sender";
import { approvalViewSchema } from "./view-schema";

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

  test("a reply carries every recipient and the quote line; a view with 10 Cc parses", () => {
    const cc = Array.from({ length: 10 }, (_, i) => `c${i}@firma.pl`);
    const reply = {
      kind: "reply",
      to: ["klient@firma.pl"],
      cc,
      language: "en",
      body: "Thanks, I will check.",
      request_id: "44444444-4444-4444-8444-444444444444",
      folder: "INBOX",
      recipients: "all",
    } satisfies DraftPayload;
    const view = approvalViewOf(build(reply), {
      draft: reply,
      original: { ...original, fromName: "Klient" },
      external: true,
      synthetic: false,
      recipientInactive: false,
    });
    expect(view.kind).toBe("reply");
    expect(view.recipient).toEqual({ name: null, address: "klient@firma.pl" });
    expect(view.to).toEqual(["klient@firma.pl"]);
    expect(view.cc).toEqual(cc);
    expect(view.subject).toBe("Re: Oferta");
    expect(view.dueDate).toBeNull();
    expect(view.quote?.text).toStartWith("On Fri 6 Nov 10:00, klient@firma.pl wrote:\n> line 0");
    expect(approvalViewSchema.safeParse(view).success).toBe(true);
    expect(approvalViewSchema.safeParse({ ...view, cc: [...cc, "x@y.pl"] }).success).toBe(false);
  });
});

describe("approvalViewOf by kind", () => {
  const followUp = {
    kind: "follow_up",
    loop_id: "55555555-5555-4555-8555-555555555555",
    to: ["a@firma.pl", "b@firma.pl"],
    cc: ["c@firma.pl"],
    language: "en",
    sent_at: "2026-11-05T09:00:00Z",
    subject: "Oferta",
    quote: "Please send the offer.",
    n: 2,
  } satisfies DraftPayload;
  const reply = {
    kind: "reply",
    to: ["klient@firma.pl"],
    cc: [],
    language: "en",
    body: "Thanks.",
    request_id: "44444444-4444-4444-8444-444444444444",
    folder: "INBOX",
    recipients: "from",
  } satisfies DraftPayload;
  const flags = { external: true, synthetic: false, recipientInactive: false };

  test("a follow-up has no sender and lists every recipient and its number", () => {
    const view = approvalViewOf(build(followUp), { draft: followUp, original, ...flags });
    expect(view.kind).toBe("follow_up");
    expect(view.sender).toBeNull();
    expect(view.recipient).toEqual({ name: null, address: "a@firma.pl" });
    expect(view.to).toEqual(["a@firma.pl", "b@firma.pl"]);
    expect(view.cc).toEqual(["c@firma.pl"]);
    expect(view.followUpNumber).toBe(2);
    expect(view.gaps).toBeUndefined();
  });

  test("a delegation view has none of the follow-up and reply fields", () => {
    const view = approvalViewOf(build(delegation), { draft: delegation, original, ...flags });
    expect(Object.keys(view).sort()).toEqual(
      ["body", "dueDate", "kind", "quote", "recipient", "recipientInactive", "sender", "subject", "synthetic"].sort()
    );
    expect(view.sender).toEqual({ label: "klient@firma.pl", external: true });
  });

  test("a reply view lists at most 20 gaps", () => {
    const body = Array.from({ length: 25 }, (_, i) => `[[gap ${i}]]`).join(" ");
    const draft = { ...reply, body };
    const view = approvalViewOf(build(draft), { draft, original, ...flags });
    expect(view.gaps).toEqual(Array.from({ length: 20 }, (_, i) => `gap ${i}`));
  });

  test("a message with no recipient is refused", () => {
    expect(() => approvalViewOf({ ...build(delegation), to: [] }, { draft: delegation, original, ...flags })).toThrow(
      /^message has no recipient$/
    );
  });
});
