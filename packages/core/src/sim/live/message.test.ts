import { describe, expect, test } from "bun:test";

import type { CaseText } from "../files";
import type { Scenario } from "../scenario";
import type { Slot } from "../slot";

import { labMessageId, parseLabMessageId, toLabMessage } from "./message";
import type { LiveRunPlan } from "./run-plan";

const RUN = "week-20261123-a1b2";
const MAILBOX = "wiktor.szalewski@kordelan.test";

const scenario = {
  executive: { key: "prezes", displayName: "Wiktor Szalewski", address: "x@kordelan.test" },
  calendar: { bankStart: "2027-01-04", weekStart: "2027-01-25" },
  personas: [
    { key: "klient", displayName: "Anna Klient", address: "anna@klient.test" },
    { key: "erp", displayName: "ERP System", address: "erp@kordelan.test" },
  ],
} as unknown as Scenario;

function slot(overrides: Partial<Slot> & { id: string }): Slot {
  return {
    persona: "klient",
    direction: "in",
    to: ["prezes"],
    cc: [],
    receivedAt: "2027-01-25T07:00:00.000Z",
    hardCases: [],
    headers: {},
    ...overrides,
  } as unknown as Slot;
}

const root = slot({ id: "w-1-001" });
const middle = slot({ id: "w-1-002", persona: "prezes", direction: "sent", to: ["klient"], parentId: "w-1-001" });
const reply = slot({ id: "w-1-003", parentId: "w-1-002", cc: ["erp"] });

const plan = {
  runId: RUN,
  offsetDays: -63,
  items: [
    { slotId: "w-1-001", at: "2026-11-23T07:00:00.000Z" },
    { slotId: "w-1-002", at: "2026-11-23T08:00:00.000Z" },
    { slotId: "w-1-003", at: "2026-11-23T09:00:00.000Z" },
    { slotId: "w-1-004", at: "2026-11-23T10:00:00.000Z" },
    { slotId: "w-1-005", at: "2026-11-23T11:00:00.000Z" },
  ],
} as unknown as LiveRunPlan;

const text: CaseText = { id: "x", subject: "Termin 29.01.2027", body: "Do 29.01.2027 prosze o odpowiedz.", thread: [] };

function build(target: Slot, parents: Slot[] = [], body: CaseText = text) {
  return toLabMessage({ slot: target, text: body, scenario, plan, mailbox: MAILBOX, parents });
}

describe("labMessageId and parseLabMessageId", () => {
  test("1 the id has the slot, the run and the sender domain; parse gives the parts back", () => {
    const id = labMessageId("w-1-001", RUN, "kordelan.test");
    expect(id).toBe("<w-1-001.week-20261123-a1b2@kordelan.test>");
    expect(parseLabMessageId(id)).toEqual({ slotId: "w-1-001", runId: RUN });
    expect(parseLabMessageId(id.slice(1, -1))).toEqual({ slotId: "w-1-001", runId: RUN });
  });

  test("1 a foreign id and a bot reply id (review N12) parse to null", () => {
    expect(parseLabMessageId("<abc@x.test>")).toBeNull();
    expect(parseLabMessageId("<r.0123456789ab.done@kordelan.test>")).toBeNull();
    expect(parseLabMessageId("<w-1-001.week-20261123@kordelan.test>")).toBeNull();
    expect(parseLabMessageId("<w-1-001.month-20261123-a1b2@kordelan.test>")).toBeNull();
    expect(parseLabMessageId("<w-1-001.week-20261123-A1B2@kordelan.test>")).toBeNull();
    expect(parseLabMessageId("<w-1-001.week-20261123-a1b2@kordelan.test")).toBeNull();
    expect(parseLabMessageId("")).toBeNull();
  });

  test.each([
    ["with spaces around the brackets", "  <w-1-001.week-20261123-a1b2@kordelan.test> \n"],
    ["with spaces around the bare form", " \tw-1-001.week-20261123-a1b2@kordelan.test  "],
  ])("an id %s gives the slot and the run", (_name, raw) => {
    expect(parseLabMessageId(raw)).toEqual({ slotId: "w-1-001", runId: RUN });
  });
});

describe("toLabMessage", () => {
  test("a plain incoming slot goes by SMTP to the mailbox, with its date and shifted text", () => {
    const message = build(root);
    expect(message.kind).toBe("smtp");
    expect(message.messageId).toBe("<w-1-001.week-20261123-a1b2@klient.test>");
    expect(message.from).toEqual({ name: "Anna Klient", address: "anna@klient.test" });
    expect(message.to).toEqual([MAILBOX]);
    expect(message.date).toBe("2026-11-23T07:00:00.000Z");
    expect(message.subject).toBe("Termin 27.11.2026");
    expect(message.text).toBe("Do 27.11.2026 prosze o odpowiedz.");
    expect(message.html).toBeUndefined();
    expect(message.inReplyTo).toBeUndefined();
    expect(message.references).toEqual([]);
  });

  test("2 a reply with a 2-deep chain points at the parent and lists the chain root first", () => {
    const message = build(reply, [root, middle]);
    expect(message.inReplyTo).toBe("<w-1-002.week-20261123-a1b2@kordelan.test>");
    expect(message.references).toEqual([
      "<w-1-001.week-20261123-a1b2@klient.test>",
      "<w-1-002.week-20261123-a1b2@kordelan.test>",
    ]);
    expect(message.cc).toEqual(["erp@kordelan.test"]);
  });

  test("a reply answers the last slot of the chain, whatever its length", () => {
    const first = build(middle, [root]);
    expect(first.inReplyTo).toBe("<w-1-001.week-20261123-a1b2@klient.test>");
    expect(first.references).toEqual(["<w-1-001.week-20261123-a1b2@klient.test>"]);
    const third = build(slot({ id: "w-1-004", parentId: "w-1-003" }), [root, middle, reply]);
    expect(third.inReplyTo).toBe("<w-1-003.week-20261123-a1b2@klient.test>");
    expect(third.references).toHaveLength(3);
  });

  test("a slot with no parent has no In-Reply-To header at all", () => {
    expect(Object.keys(build(root))).not.toContain("inReplyTo");
  });

  test("3 a sent slot is appended to Sent, from the executive at the mailbox", () => {
    const message = build(middle, [root]);
    expect(message.kind).toBe("append_sent");
    expect(message.from).toEqual({ name: "Wiktor Szalewski", address: MAILBOX });
    expect(message.to).toEqual(["anna@klient.test"]);
    expect(message.messageId).toBe("<w-1-002.week-20261123-a1b2@kordelan.test>");
  });

  test("4 a bounce slot takes its fromOverride as the sender and the Message-ID domain", () => {
    const message = build(slot({ id: "w-1-004", persona: "erp", fromOverride: "mailer-daemon@kordelan.test" }));
    expect(message.from.address).toBe("mailer-daemon@kordelan.test");
    expect(message.messageId).toBe("<w-1-004.week-20261123-a1b2@kordelan.test>");
  });

  test("an html_only slot carries html only; an html slot carries both; the slot headers pass unchanged", () => {
    const htmlOnly = build(slot({ id: "w-1-005", hardCases: ["html_only"], headers: { "X-Test": "1" } }), [], {
      ...text,
      body: "",
      html: "<p>Do 29.01.2027</p>",
    });
    expect(htmlOnly.text).toBeUndefined();
    expect(htmlOnly.html).toBe("<p>Do 27.11.2026</p>");
    expect(htmlOnly.headers).toEqual({ "X-Test": "1" });
    const both = build(root, [], { ...text, html: "<p>x</p>" });
    expect(both.text).toBeDefined();
    expect(both.html).toBe("<p>x</p>");
  });

  test("a slot outside the plan or a persona key that is unknown throws with the id only", () => {
    expect(() => build(slot({ id: "w-2-001" }))).toThrow("w-2-001");
    expect(() => build(slot({ id: "w-1-001", persona: "nobody" }))).toThrow("nobody");
  });
});
