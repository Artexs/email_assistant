import { describe, expect, test } from "bun:test";

import { loopSections } from "../loops/brief";
import { briefInput, loop as briefLoop, part } from "../loops/brief-fixtures.test-helper";
import { textTables } from "../texts";
import { MINUTE_MS } from "../time";

import {
  digestMinimalFacts,
  renderDigestMinimal,
  renderDigestWithBrief,
  type DigestMinimalFacts,
  type DigestInput,
  type DigestMailbox,
} from "./digest";
import { timeZone, now, slot, mailbox, item, input, render, blockStarts } from "./digest.test-helper";

describe("the minimal digest", () => {
  const facts: DigestMinimalFacts = {
    at: new Date("2026-03-02T07:00:00Z"),
    scheduled: true,
    late: false,
    timeZone,
    action: { urgent: 2, needs_reply: 1, delegation: 0, unsure: 0 },
    other: { info: 0, notification: 0, spam: 0 },
    mailboxProblems: 0,
    openLoops: null,
  };

  test("a scheduled digest shows the slot clock, both sections with counts and the link", () => {
    expect(renderDigestMinimal(facts, textTables.en, "https://p.test/x")).toEqual({
      text: [
        "📬 Digest 08:00 · Mon 2 Mar",
        "NEEDS ACTION · 3: 2 urgent, 1 reply",
        "OTHER MAIL · 0",
        "https://p.test/x",
      ].join("\n"),
      buttons: [],
    });
  });

  test.each([
    { name: "no mailbox with a problem gives no line", problems: 0, line: null },
    { name: "one mailbox with a problem gives the singular line", problems: 1, line: "⚠️ 1 mailbox has a problem" },
    { name: "three mailboxes with a problem give the plural line", problems: 3, line: "⚠️ 3 mailboxes have a problem" },
  ])("$name", ({ problems, line }) => {
    const lines = renderDigestMinimal({ ...facts, mailboxProblems: problems }, textTables.en, "link").text.split("\n");
    expect(lines).toEqual([
      "📬 Digest 08:00 · Mon 2 Mar",
      "NEEDS ACTION · 3: 2 urgent, 1 reply",
      "OTHER MAIL · 0",
      ...(line === null ? [] : [line]),
      "link",
    ]);
  });

  test.each([
    { name: "no open loop gives no line", loops: { waiting: 0, promised: 0 }, line: null },
    {
      name: "a waiting loop alone gives the waiting count",
      loops: { waiting: 1, promised: 0 },
      line: "🔁 Open loops: 1 waiting",
    },
    {
      name: "a promise alone gives the promise count",
      loops: { waiting: 0, promised: 2 },
      line: "🔁 Open loops: 2 promises due",
    },
  ])("$name", ({ loops, line }) => {
    const lines = renderDigestMinimal({ ...facts, openLoops: loops }, textTables.en, "link").text.split("\n");
    expect(lines.slice(3)).toEqual([...(line === null ? [] : [line]), "link"]);
  });

  test("the Polish digest follows the Polish plurals and a section with no mail shows its count only", () => {
    const text = renderDigestMinimal(
      {
        ...facts,
        action: { urgent: 0, needs_reply: 0, delegation: 0, unsure: 0 },
        other: { info: 5, notification: 0, spam: 2 },
      },
      textTables.pl,
      "link"
    ).text;
    expect(text.split("\n").slice(1)).toEqual(["WYMAGA DZIAŁANIA · 0", "POZOSTAŁE · 7: 5 info, 2 spam", "link"]);
  });
});

describe("the header of a digest", () => {
  const headerOf = (digest: DigestInput): string => render(digest).text.split("\n")[0] as string;

  test("a scheduled digest with a slot shows the slot time; an on-demand one shows the time of the build, slot or not", () => {
    expect(headerOf(input())).toBe("📬 Digest 08:00 · Fri 6 Nov");
    expect(headerOf(input({ slot: { date: "2026-11-06", time: "08:00", late: true } }))).toBe(
      "📬 Digest 08:00 · Fri 6 Nov (late)"
    );
    expect(headerOf(input({ kind: "on_demand" }))).toBe("📬 Digest now · Fri 6 Nov 08:00");
    expect(headerOf(input({ kind: "on_demand", slot: { date: "2026-11-05", time: "09:00", late: false } }))).toBe(
      "📬 Digest now · Fri 6 Nov 08:00"
    );
    expect(headerOf(input({ slot: null }))).toBe("📬 Digest now · Fri 6 Nov 08:00");
  });
});

describe("the minimal facts of a digest", () => {
  const problems = (box: Partial<DigestMailbox>): number =>
    digestMinimalFacts(input({ mailboxes: [{ ...mailbox, ...box }] })).mailboxProblems;

  test.each([
    {
      name: "an active mailbox that synced exactly 30 minutes ago",
      box: { lastSyncedAt: new Date(now.getTime() - 30 * MINUTE_MS) },
      count: 0,
    },
    { name: "a paused mailbox that synced a minute ago", box: { status: "paused" as const }, count: 1 },
    { name: "a mailbox with a login error", box: { status: "auth_error" as const }, count: 1 },
    { name: "a mailbox with a blocked host", box: { status: "host_blocked" as const }, count: 1 },
  ])("$name counts $count", ({ box, count }) => {
    expect(problems(box)).toBe(count);
  });

  test("a scheduled digest has the slot instant; an on-demand one has the build instant even with a slot", () => {
    const slotAt = new Date("2026-11-06T07:00:00Z");
    const scheduled = digestMinimalFacts(input({ slot: { ...slot, late: true } }));
    expect([scheduled.at, scheduled.scheduled, scheduled.late]).toEqual([slotAt, true, true]);
    const onDemand = digestMinimalFacts(input({ kind: "on_demand", slot: { ...slot, late: true } }));
    expect([onDemand.at, onDemand.scheduled, onDemand.late]).toEqual([now, false, false]);
    const noSlot = digestMinimalFacts(input({ slot: null }));
    expect([noSlot.at, noSlot.scheduled, noSlot.late]).toEqual([now, false, false]);
  });
});

describe("a mailbox that synced exactly 30 minutes ago", () => {
  test("the line is the plain one; a millisecond more makes it late", () => {
    const line = (ago: number): string =>
      render(input({ mailboxes: [{ ...mailbox, lastSyncedAt: new Date(now.getTime() - ago) }] })).text.split(
        "\n"
      )[2] as string;
    expect(line(30 * MINUTE_MS)).toBe("🔄 Last sync 07:30");
    expect(line(30 * MINUTE_MS + 1)).toBe("⚠️ Last sync 07:29 (late)");
  });
});

describe("the footer of a digest with a brief", () => {
  const withBrief = (extra: Partial<NonNullable<DigestInput["brief"]>>): NonNullable<DigestInput["brief"]> => ({
    sections: null,
    loopConsent: true,
    owner: true,
    urgentEmailIds: [],
    openLoops: null,
    ...extra,
  });
  const lastLine = (digest: DigestInput): string => render(digest).text.split("\n").at(-1) as string;

  test.each([
    { name: "no open loop gives no count line", loops: { waiting: 0, promised: 0 }, line: "🔄 Last sync 07:55" },
  ])("$name", ({ loops, line }) => {
    expect(lastLine(input({ brief: withBrief({ openLoops: loops }) }))).toBe(line);
  });

  test("the urgent mails of the brief leave the list and the more line counts only the other mails of their category", () => {
    const urgent = [item(1, "urgent"), item(2, "urgent")];
    const text = render(
      input({
        items: [...urgent, item(3, "urgent")],
        counts: { urgent: 6 },
        brief: withBrief({ urgentEmailIds: urgent.map((row) => row.emailId) }),
      })
    ).text;
    expect(blockStarts(text)).toHaveLength(1);
    expect(text.split("\n").at(-2)).toBe("+3 more: 3 urgent");
  });

  test("a digest in shadow mode needs every mailbox in shadow mode for the shadow line", () => {
    const text = render(
      input({
        items: [item(1, "info")],
        counts: { info: 1 },
        mailboxes: [mailbox, { ...mailbox, id: "m2", address: "other@firma.test", mode: "assist" }],
      })
    ).text;
    expect(text.includes("Shadow mode")).toBe(false);
  });

  test("a digest with a brief block has an empty line before and after the block", () => {
    const sections = loopSections(briefInput({ now, timeZone, waitingLoops: part([briefLoop(1)]) }));
    expect(render(input({ brief: withBrief({ sections }) })).text.split("\n")).toEqual([
      "📬 Digest 08:00 · Fri 6 Nov",
      "",
      "📌 NEEDS YOU TODAY",
      "",
      "⏳ No answer from anna@example.test since Tue 10.11 · Offer for Q1",
      "",
      "No new mail since 5 Nov 16:00.",
      "🔄 Last sync 07:55",
    ]);
  });
});

describe("one mail without a summary and the cut text", () => {
  test("a mail with no AI text has no summary line and no empty line in its block", () => {
    const text = render(input({ items: [item(1, "info", { aiText: null })], counts: { info: 1 } })).text;
    expect(text.split("\n").slice(3, 8)).toEqual([
      "",
      "OTHER MAIL · 1",
      "1. ℹ️ Info · Ann1 <ann1@firma.test>",
      "Subject 1",
      "→ would flag",
    ]);
  });

  test("a text cut to the limit has no buttons and names no loop", () => {
    const mailboxes = Array.from({ length: 100 }, (_, i) => ({ ...mailbox, id: `m${i}`, address: "x".repeat(60) }));
    const rendered = renderDigestWithBrief(
      input({ mailboxes, items: [item(1, "info")], counts: { info: 1 } }),
      textTables.en
    );
    expect(rendered.shown).toEqual({ surfaced: [], stale: [], lineOf: {} });
    expect(rendered.message.buttons).toEqual([]);
  });

  test("two rows of 4 buttons share one keyboard line of 8; a third button on a row starts a new line", () => {
    const four = { undoable: true, delegable: true };
    const shared = render(
      input({ items: [item(1, "needs_reply", four), item(2, "needs_reply", four)], counts: { needs_reply: 2 } })
    );
    expect(shared.buttons.map((row) => row.length)).toEqual([8]);
    const apart = render(
      input({
        items: [item(1, "needs_reply", { ...four, draftable: true }), item(2, "needs_reply", four)],
        counts: { needs_reply: 2 },
      })
    );
    expect(apart.buttons.map((row) => row.length)).toEqual([4, 5]);
  });
});
