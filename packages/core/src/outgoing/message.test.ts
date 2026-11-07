import { describe, expect, test } from "bun:test";

import type { DraftPayload } from "../triage/payloads";

import { buildOutgoingMessage, outgoingSubject, type BuildInput, type OriginalMail } from "./message";

const ID = "11111111-1111-4111-8111-111111111111";
const DELEGATE = "22222222-2222-4222-8222-222222222222";
const createdAt = new Date("2026-11-07T08:00:00Z");

const original: OriginalMail = {
  fromAddress: "klient@firma.pl",
  subject: "Oferta",
  receivedAt: new Date("2026-11-06T09:00:00Z"),
  messageId: "<orig@firma.pl>",
  inReplyTo: "<prev@firma.pl>",
  references: ["<root@firma.pl>", "<prev@firma.pl>"],
  bodyText: "Prosze o oferte.",
};

const delegation = {
  kind: "delegation",
  delegate_id: DELEGATE,
  delegate_name: "Jan",
  to: ["jan@firma.pl"],
  task: "Przygotuj ofertę",
  due_date: "2026-11-10",
  language: "pl",
} satisfies DraftPayload;

function input(draft: DraftPayload, patch: Partial<BuildInput> = {}, mail: Partial<OriginalMail> = {}): BuildInput {
  return {
    draft,
    draftActionId: ID,
    createdAt,
    mailbox: { address: "User@Interia.pl" },
    owner: { displayName: "Artek" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    original: { ...original, ...mail },
    ...patch,
  };
}

describe("buildOutgoingMessage", () => {
  test("builds a delegation", () => {
    const message = buildOutgoingMessage(input(delegation));
    expect(message.messageId).toBe(`<ea-${ID}@interia.pl>`);
    expect(message.date).toEqual(createdAt);
    expect(message.from).toEqual({ name: "Artek", address: "User@Interia.pl" });
    expect(message.to).toEqual([{ name: "Jan", address: "jan@firma.pl" }]);
    expect(message.subject).toBe("Fwd: Oferta");
    expect(message.inReplyTo).toBeNull();
    expect(message.references).toEqual(["<root@firma.pl>", "<prev@firma.pl>", "<orig@firma.pl>"]);
    expect(message.headers).toEqual({ "X-EA-Action-Id": ID });
    expect(message.text).toContain("przekazuję do realizacji: Przygotuj ofertę");
    expect(message.text).toContain("Termin: 2026-11-10");
    expect(message.parts.quote).toContain("> Prosze o oferte.");
    expect(message.text).toBe(`${message.parts.body}\n\n${message.parts.quote}`);
  });

  test("is deterministic", () => {
    expect(buildOutgoingMessage(input(delegation))).toEqual(buildOutgoingMessage(input(delegation)));
  });

  test("keeps a forward prefix and names a missing subject", () => {
    expect(buildOutgoingMessage(input(delegation, {}, { subject: "FW: Oferta" })).subject).toBe("FW: Oferta");
    expect(buildOutgoingMessage(input(delegation, {}, { subject: null })).subject).toBe("Fwd: (no subject)");
  });

  test("builds a clarification", () => {
    const draft = {
      kind: "clarification",
      to: ["klient@firma.pl"],
      question: "Jaki termin?",
      language: "en",
    } satisfies DraftPayload;
    const message = buildOutgoingMessage(input(draft));
    expect(message.subject).toBe("Re: Oferta");
    expect(message.inReplyTo).toBe("<orig@firma.pl>");
    expect(message.references).toEqual(["<root@firma.pl>", "<prev@firma.pl>", "<orig@firma.pl>"]);
    expect(message.to).toEqual([{ name: null, address: "klient@firma.pl" }]);
    expect(message.text).toContain("I need one more thing: Jaki termin?");
    expect(buildOutgoingMessage(input(draft, {}, { subject: "Odp: Oferta" })).subject).toBe("Odp: Oferta");
  });

  test("builds a reminder from the thread in the payload", () => {
    const draft = {
      kind: "reminder",
      delegate_id: DELEGATE,
      delegate_name: "Jan",
      to: ["jan@firma.pl"],
      task: "Przygotuj ofertę",
      due_date: "2026-11-10",
      language: "pl",
      delegation_id: DELEGATE,
      reminder: 1,
      thread: { in_reply_to: "<sent@interia.pl>", references: ["<orig@firma.pl>", "<sent@interia.pl>"] },
    } satisfies DraftPayload;
    const message = buildOutgoingMessage(input(draft));
    expect(message.subject).toBe("Re: Fwd: Oferta");
    expect(message.inReplyTo).toBe("<sent@interia.pl>");
    expect(message.references).toEqual(["<orig@firma.pl>", "<sent@interia.pl>"]);
    expect(message.parts.quote).toBeNull();
    expect(message.text).toBe(message.parts.body);
    expect(message.text).toContain("Termin minął: 2026-11-10.");
    expect(outgoingSubject("reminder", "Re: Oferta")).toBe("Re: Oferta");
  });

  test("picks the signature", () => {
    const sign = (styleText: string | null) =>
      buildOutgoingMessage(input(delegation, { organization: { styleText, timezone: "Europe/Warsaw" } })).parts.body;
    expect(sign(null)).toEndWith("\n\nArtek");
    expect(sign("  ")).toEndWith("\n\nArtek");
    expect(sign("Pozdrawiam, Artek")).toEndWith("\n\nPozdrawiam, Artek");
  });

  test("marks links and phones and keeps LLM text on one line", () => {
    const linked = buildOutgoingMessage(input({ ...delegation, task: "Odwiedź http://x.test i zadzwoń 600 100 200" }));
    expect(linked.parts.body).toContain("[link]");
    expect(linked.parts.body).toContain("[phone]");
    expect(linked.parts.body).not.toContain("x.test");
    const injected = buildOutgoingMessage(input({ ...delegation, task: "Zrób\n\nSubject: hacked" }));
    expect(injected.parts.body).toContain("przekazuję do realizacji: Zrób Subject: hacked\n");
    expect(injected.parts.body).not.toContain("\nSubject: hacked");
  });

  test("has no duplicate references", () => {
    const message = buildOutgoingMessage(input(delegation, {}, { references: ["<root@firma.pl>", "<orig@firma.pl>"] }));
    expect(message.references).toEqual(["<root@firma.pl>", "<orig@firma.pl>"]);
  });
});
