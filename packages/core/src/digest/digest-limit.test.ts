import { describe, expect, test } from "bun:test";

import { loopSections } from "../loops/brief";
import {
  briefInput,
  loop as briefLoop,
  mail as briefMail,
  part,
  uuid as briefUuid,
} from "../loops/brief-fixtures.test-helper";
import { textTables } from "../texts";

import { renderDigestWithBrief, type DigestInput, type DigestMailbox } from "./digest";
import { timeZone, now, mailbox, item, input, render } from "./digest.test-helper";
import { MESSAGE_MAX_CHARS } from "./message";

// A scheduled digest whose text is `length` characters long when the last address is `lastAddress(units)` with `units` code
// units: mailbox lines of 40-character addresses, and the last two addresses (the last one has 5 to 39 units) take the rest.
// A mailbox line adds the same number of characters whatever its number.
function digestOfLength(
  length: number,
  lastAddress: (units: number) => string,
  extra: Partial<DigestInput> = {}
): DigestInput {
  const mailboxOf = (n: number, address: string): DigestMailbox => ({ ...mailbox, id: `m${n}`, address });
  const boxes = (count: number, last: string, beforeLast = "x".repeat(40)): DigestMailbox[] =>
    Array.from({ length: count }, (_, n) =>
      mailboxOf(n, n === count - 1 ? last : n === count - 2 ? beforeLast : "x".repeat(40))
    );
  const lengthOf = (count: number): number =>
    render(input({ ...extra, mailboxes: boxes(count, "x".repeat(40)) })).text.length;
  const [two, three] = [lengthOf(2), lengthOf(3)] as [number, number];
  const lineLength = three - two;
  const count = 2 + Math.ceil((length + 1 - two) / lineLength);
  const cut = two + (count - 2) * lineLength - length;
  const lastCut = Math.min(cut, 35);
  return input({
    ...extra,
    mailboxes: boxes(count, lastAddress(40 - lastCut), "x".repeat(40 - (cut - lastCut))),
  });
}

describe("the 4096 characters of a message", () => {
  const plain = (units: number): string => "x".repeat(units);
  const textOf = (digest: DigestInput): string => render(digest).text;

  test("a text of exactly the maximum stays whole", () => {
    const text = textOf(digestOfLength(MESSAGE_MAX_CHARS, plain));
    expect(text.length).toBe(MESSAGE_MAX_CHARS);
    expect(text.endsWith("x")).toBe(true);
  });

  test("a text one character over is cut to the maximum with the mark at the end", () => {
    const digest = digestOfLength(MESSAGE_MAX_CHARS, plain);
    const whole = textOf(digest);
    const message = render({
      ...digest,
      mailboxes: digest.mailboxes.map((box, index, all) =>
        index === all.length - 1 ? { ...box, address: `${box.address}x` } : box
      ),
    });
    expect(message.text).toBe(`${whole.slice(0, MESSAGE_MAX_CHARS - 1)}…`);
    expect(message.text.length).toBe(MESSAGE_MAX_CHARS);
    expect(message.buttons).toEqual([]);
  });

  // The text is 2 characters over the maximum, so the cut keeps MAX - 1 characters; when the last one kept is the first half of
  // a surrogate pair, the pair goes whole and the cut keeps MAX - 2.
  test.each([
    { name: "the first half of the first pair", tail: "\u{10000}xx", kept: MESSAGE_MAX_CHARS - 2 },
    { name: "the first half of the last pair", tail: "\u{10ffff}xx", kept: MESSAGE_MAX_CHARS - 2 },
    { name: "the second half of a pair", tail: "\u{10000}xxx", kept: MESSAGE_MAX_CHARS - 1 },
    { name: "the last character before the surrogates", tail: "\ud7ffxxx", kept: MESSAGE_MAX_CHARS - 1 },
  ])("a cut at $name keeps $kept characters before the mark", ({ tail, kept }) => {
    const length = MESSAGE_MAX_CHARS + 2;
    const address = (units: number): string => `${plain(units - tail.length)}${tail}`;
    const prefix = textOf(digestOfLength(length, plain)).slice(0, length - tail.length);
    const message = render(digestOfLength(length, address));
    expect(message.text).toBe(`${`${prefix}${tail}`.slice(0, kept)}…`);
    expect(message.buttons).toEqual([]);
  });
});

describe("a digest with a brief at the 4096 characters", () => {
  const sections = loopSections(
    briefInput({ now, timeZone, waitingLoops: part([briefLoop(1)]), urgent: part([briefMail(1)]) })
  );
  const brief = {
    sections,
    loopConsent: true,
    owner: true,
    urgentEmailIds: [briefUuid(1)],
    openLoops: null,
  };
  const plain = (units: number): string => "x".repeat(units);

  test("a text of exactly the maximum keeps every line of the brief", () => {
    const rendered = renderDigestWithBrief(digestOfLength(MESSAGE_MAX_CHARS, plain, { brief }), textTables.en);
    expect(rendered.message.text.length).toBe(MESSAGE_MAX_CHARS);
    expect(rendered.shown.surfaced).toEqual([briefUuid(101)]);
  });
});

describe("the options of the brief lines", () => {
  const sections = loopSections(
    briefInput({
      now,
      timeZone,
      urgent: part([briefMail(1, { receivedAt: new Date("2026-11-05T05:00:00Z") })], 3),
      waitingLoops: part([briefLoop(1, { sinceAt: new Date("2026-11-10T21:30:00Z") })]),
    })
  );
  const brief: NonNullable<DigestInput["brief"]> = {
    sections,
    loopConsent: true,
    owner: true,
    urgentEmailIds: [briefUuid(1)],
    openLoops: null,
  };
  const briefLines = (digest: DigestInput): string[] => render(digest).text.split("\n").slice(2, 8);

  test("the age of a line counts from the clock of the digest and the day follows its time zone", () => {
    const lines = briefLines(
      input({
        counts: { urgent: 3 },
        brief: { ...brief, links: { urgent: "https://panel.test/urgent" } },
        items: [item(1, "urgent", { emailId: briefUuid(1) })],
      })
    );
    expect(lines).toEqual([
      "📌 NEEDS YOU TODAY",
      "",
      "🔴 Jan Kowalski 1 <jan1@firma.test> · Oferta Q1 · 1 d",
      "+2 more in the panel: https://panel.test/urgent",
      "",
      "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1",
    ]);
  });
});
