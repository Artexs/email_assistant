// The follow-up kind, its template and its message.
import { describe, expect, test } from "bun:test";

import { draftPayloadSchema, sendPayloadFor, sendRecipients, type DraftPayload } from "../triage/payloads";

import { buildOutgoingMessage, FOLLOW_UP_REFERENCES_MAX, type BuildInput } from "./message";
import { formatSentDate, QUOTE_MAX_CHARS, quoteSent } from "./quote";

const ID = "11111111-1111-4111-8111-111111111111";
const LOOP = "33333333-3333-4333-8333-333333333333";
const SENT_AT = "2026-11-10T09:30:00.000Z";

type FollowUp = Extract<DraftPayload, { kind: "follow_up" }>;

function followUp(patch: Partial<FollowUp> = {}): FollowUp {
  return {
    kind: "follow_up",
    loop_id: LOOP,
    to: ["anna@example.test"],
    cc: ["jan@example.test", "ewa@example.test"],
    language: "pl",
    sent_at: SENT_AT,
    subject: "Oferta Q1",
    quote: "Czy możesz potwierdzić termin?\nDziękuję.",
    n: 1,
    ...patch,
  };
}

function input(draft: DraftPayload, refs: string[] = ["<root@x.test>"]): BuildInput {
  return {
    draft,
    draftActionId: ID,
    createdAt: new Date("2026-11-14T08:00:00Z"),
    mailbox: { address: "User@Interia.pl" },
    owner: { displayName: "Artek" },
    organization: { timezone: "Europe/Warsaw" },
    // The server fills the thread ids from the loop row; the other fields of the mail are not used by a follow-up.
    original: {
      fromAddress: null,
      subject: null,
      receivedAt: new Date(SENT_AT),
      messageId: "<own@interia.pl>",
      inReplyTo: null,
      references: refs,
      bodyText: null,
    },
  };
}

describe("follow-up message", () => {
  test("T1 the exact texts of follow-up 1 and 2 in Polish and English", () => {
    const pl1 = buildOutgoingMessage(input(followUp({ n: 1 })));
    expect(pl1.parts.body).toBe(
      "Dzień dobry,\n\nwracam do mojej wiadomości z 10.11.2026 w sprawie „Oferta Q1”. Czy mogę prosić o informację, jak wygląda sprawa?\n\nArtek"
    );
    const pl2 = buildOutgoingMessage(input(followUp({ n: 2 })));
    expect(pl2.parts.body).toBe(
      "Dzień dobry,\n\nponownie piszę w sprawie mojej wiadomości z 10.11.2026 („Oferta Q1”). Z góry dziękuję za krótką odpowiedź.\n\nArtek"
    );
    const en1 = buildOutgoingMessage(input(followUp({ n: 1, language: "en" })));
    expect(en1.parts.body).toBe(
      'Hello,\n\nI am coming back to my message of 10 Nov 2026 about "Oferta Q1". Could you let me know where this stands?\n\nArtek'
    );
    const en2 = buildOutgoingMessage(input(followUp({ n: 2, language: "en" })));
    expect(en2.parts.body).toBe(
      'Hello,\n\nI am writing again about my message of 10 Nov 2026 about "Oferta Q1". I would be grateful for a short answer.\n\nArtek'
    );
  });

  test("the quote header and the quoted lines follow the language", () => {
    const pl = buildOutgoingMessage(input(followUp()));
    expect(pl.parts.quote).toBe("Moja wiadomość z 10.11.2026:\n> Czy możesz potwierdzić termin?\n> Dziękuję.");
    expect(pl.text).toBe(`${pl.parts.body}\n\n${pl.parts.quote}`);
    const en = buildOutgoingMessage(input(followUp({ language: "en" })));
    expect(en.parts.quote?.startsWith("My message of 10 Nov 2026:\n> ")).toBe(true);
  });

  test("the day of the own mail is the day in the time zone of the organization", () => {
    const lateEvening = new Date("2026-11-10T23:30:00Z"); // 11 Nov 00:30 in Warsaw
    expect(formatSentDate(lateEvening, "Europe/Warsaw", "pl")).toBe("11.11.2026");
    expect(formatSentDate(lateEvening, "Europe/Warsaw", "en")).toBe("11 Nov 2026");
    expect(formatSentDate(new Date("2026-09-03T10:00:00Z"), "Europe/Warsaw", "en")).toBe("3 Sep 2026");
  });

  test("T2 the subject gets Re: unless it has a reply prefix", () => {
    expect(buildOutgoingMessage(input(followUp())).subject).toBe("Re: Oferta Q1");
    expect(buildOutgoingMessage(input(followUp({ subject: "Odp: Oferta" }))).subject).toBe("Odp: Oferta");
    expect(buildOutgoingMessage(input(followUp({ subject: "RE: Oferta" }))).subject).toBe("RE: Oferta");
    expect(buildOutgoingMessage(input(followUp({ subject: "re: Oferta" }))).subject).toBe("re: Oferta");
  });

  test("T3 a missing quote gives no quote block", () => {
    const message = buildOutgoingMessage(input(followUp({ quote: null })));
    expect(message.parts.quote).toBeNull();
    expect(message.text).toBe(message.parts.body);
  });

  test("a long quote is cut as the other quotes are", () => {
    const long = "x".repeat(QUOTE_MAX_CHARS + 50);
    const quote = quoteSent(long, new Date(SENT_AT), "en", "Europe/Warsaw") ?? "";
    expect(quote.endsWith("[…]")).toBe(true);
    expect(Array.from(quote).length).toBeLessThan(QUOTE_MAX_CHARS + 60);
  });

  test("T4 the References are the last 20 ids and the id of the own mail is the last", () => {
    const refs = Array.from({ length: 25 }, (_, index) => `<r${index}@x.test>`);
    const message = buildOutgoingMessage(input(followUp(), refs));
    expect(message.references).toHaveLength(FOLLOW_UP_REFERENCES_MAX);
    expect(message.references.at(-1)).toBe("<own@interia.pl>");
    expect(message.references[0]).toBe("<r6@x.test>");
    expect(message.inReplyTo).toBe("<own@interia.pl>");
  });

  test("the References hold each id once", () => {
    const message = buildOutgoingMessage(input(followUp(), ["<a@x.test>", "<own@interia.pl>", "<a@x.test>"]));
    expect(message.references).toEqual(["<a@x.test>", "<own@interia.pl>"]);
  });

  test("the recipients are the To and the Cc of the payload, and no LLM text is in the message", () => {
    const message = buildOutgoingMessage(input(followUp({ to: ["a@example.test", "b@example.test"] })));
    expect(message.to.map((entry) => entry.address)).toEqual(["a@example.test", "b@example.test"]);
    expect(message.cc.map((entry) => entry.address)).toEqual(["jan@example.test", "ewa@example.test"]);
    expect(message.headers).toEqual({ "X-EA-Action-Id": ID });
  });

  test("an edit replaces the body and the subject and keeps the quote", () => {
    const message = buildOutgoingMessage(input(followUp({ body_text: "Mój tekst", subject_text: "Nowy temat" })));
    expect(message.parts.body).toBe("Mój tekst");
    expect(message.subject).toBe("Nowy temat");
    expect(message.parts.quote).not.toBeNull();
  });

  test("the payload schema takes at most 10 recipients together and a send payload repeats them", () => {
    const many = (count: number, prefix: string): string[] =>
      Array.from({ length: count }, (_, index) => `${prefix}${index}@example.test`);
    expect(draftPayloadSchema.safeParse(followUp({ to: many(5, "t"), cc: many(5, "c") })).success).toBe(true);
    expect(draftPayloadSchema.safeParse(followUp({ to: many(5, "t"), cc: many(6, "c") })).success).toBe(false);
    expect(draftPayloadSchema.safeParse(followUp({ to: [] })).success).toBe(false);
    expect(draftPayloadSchema.safeParse({ ...followUp(), n: 3 }).success).toBe(false);
    expect(draftPayloadSchema.safeParse({ ...followUp(), sent_at: "yesterday" }).success).toBe(false);
    const send = sendPayloadFor(followUp());
    expect(send).toEqual({
      kind: "follow_up",
      to: ["anna@example.test"],
      cc: ["jan@example.test", "ewa@example.test"],
      loop_id: LOOP,
    });
  });

  test("everyone who gets the mail is the To, then the Cc, each address once", () => {
    expect(sendRecipients({ to: ["a@x.test"] })).toEqual(["a@x.test"]);
    expect(sendRecipients({ to: ["a@x.test", "b@x.test"], cc: ["c@x.test", "B@X.test", "a@x.test"] })).toEqual([
      "a@x.test",
      "b@x.test",
      "c@x.test",
    ]);
  });
});
