import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DAY_MS } from "@ea/core";

import { LabMailError } from "../../../../server/src/modules/lab/mail-client";
import { isSyntheticMessageId } from "../../../../server/src/modules/mail/seed";

import type { DemoMail, DemoRunPlan } from "./run-plan";
import {
  DEMO_FLAGS_OFF,
  DEMO_FLAGS_ON,
  demoMessage,
  hasPausedNotice,
  liveMessages,
  parseFlagList,
  pausedNoticeMarkers,
  purgeMailboxB,
  readDemoPlan,
  type SetupState,
  setupProblems,
  shiftedDates,
} from "./setup";

const MAIL: DemoMail = {
  key: "k",
  from: "anna@seed-sender.test",
  subject: "Contract for review",
  text: "Hello,\nplease read the contract.",
  category: "needs_reply",
  at: new Date("2026-11-23T08:00:00Z"),
};

describe("demoMessage", () => {
  const opts = { to: "office@kordelan.test", seq: 7, runTag: "ab12", date: new Date("2026-12-09T12:00:00Z") };

  test("carries the synthetic Message-ID, the seed sender and subject, the recipient and the RFC 5322 date", () => {
    const lines = demoMessage(MAIL, opts).split("\r\n");
    expect(lines).toContain("Message-ID: <demo-7.ab12@ea-seed.test>");
    expect(lines).toContain("From: anna@seed-sender.test");
    expect(lines).toContain("Subject: Contract for review");
    expect(lines).toContain("To: office@kordelan.test");
    expect(lines).toContain("Date: Wed, 09 Dec 2026 12:00:00 GMT");
    expect(lines.slice(lines.indexOf("") + 1).join("\r\n")).toBe("Hello,\r\nplease read the contract.");
  });

  test("a mail with no text has an empty body", () => {
    const raw = demoMessage({ ...MAIL, text: null }, opts);
    expect(raw.endsWith("\r\n\r\n")).toBe(true);
    expect(raw.split("\r\n\r\n")[1]).toBe("");
  });

  test("its Message-ID passes the synthetic-mail check of the mail module", () => {
    const id = /^Message-ID: (.+)$/m.exec(demoMessage(MAIL, opts))?.[1] ?? null;
    expect(isSyntheticMessageId(id)).toBe(true);
  });
});

describe("shiftedDates", () => {
  test("keeps the offsets and puts the newest mail 2 days before now", () => {
    const shifted = shiftedDates(
      [new Date("2026-11-25T08:00:00Z"), new Date("2026-11-27T09:00:00Z")],
      new Date("2026-12-10T12:00:00Z")
    );
    expect(shifted.map((date) => date.toISOString())).toEqual(["2026-12-06T11:00:00.000Z", "2026-12-08T12:00:00.000Z"]);
  });

  test("keeps the order of the input, newest first or not", () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const shifted = shiftedDates([new Date("2026-11-27T09:00:00Z"), new Date("2026-11-26T09:00:00Z")], now);
    expect(shifted.map((date) => now.getTime() - date.getTime())).toEqual([2 * DAY_MS, 3 * DAY_MS]);
  });

  test("a span over 25 days is demo_history_span; exactly 25 days is allowed", () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const newest = new Date("2026-11-27T09:00:00Z");
    expect(() => shiftedDates([new Date(newest.getTime() - 26 * DAY_MS), newest], now)).toThrow("demo_history_span");
    expect(shiftedDates([new Date(newest.getTime() - 25 * DAY_MS), newest], now)).toHaveLength(2);
  });

  test("no dates give no dates", () => {
    expect(shiftedDates([], new Date("2026-12-10T12:00:00Z"))).toEqual([]);
  });
});

describe("readDemoPlan", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  test("turns the ISO strings of the plan file back into dates", () => {
    const folder = mkdtempSync(join(tmpdir(), "f151-plan-"));
    folders.push(folder);
    const plan = {
      model: "m",
      promptVersion: "v3",
      mailboxB: "office@kordelan.test",
      history: [{ ...MAIL, at: new Date("2026-11-23T08:00:00Z") }],
      shadow: [{ ...MAIL, at: new Date("2026-11-24T08:00:00Z") }],
      urgent: { ...MAIL, at: new Date("2026-11-25T08:00:00Z") },
      delegation: { ...MAIL, at: new Date("2026-11-26T08:00:00Z"), delegateName: "Ola", delegateAddress: "ola@x.test" },
      undo: { ...MAIL, at: new Date("2026-11-27T08:00:00Z") },
      recommended: [],
      overdueDelegation: null,
    } satisfies DemoRunPlan;
    const file = join(folder, "demo-plan.json");
    writeFileSync(file, JSON.stringify(plan));
    const read = readDemoPlan(file);
    expect(read.history[0]?.at).toEqual(new Date("2026-11-23T08:00:00Z"));
    expect(read.shadow[0]?.at).toEqual(new Date("2026-11-24T08:00:00Z"));
    expect(read.urgent.at).toEqual(new Date("2026-11-25T08:00:00Z"));
    expect(read.delegation.at).toEqual(new Date("2026-11-26T08:00:00Z"));
    expect(read.undo.at).toEqual(new Date("2026-11-27T08:00:00Z"));
    expect(read.delegation.delegateName).toBe("Ola");
  });
});

describe("parseFlagList", () => {
  test("reads the flag lines of org:flag --org-id and skips the rest", () => {
    const text = [
      "[org-flag] org 5f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f: trust_ladder on (row)",
      "org 5f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f: open_loops off (default)",
      "warning: something else",
    ].join("\n");
    expect(parseFlagList(text)).toEqual({ trust_ladder: true, open_loops: false });
  });
});

describe("pausedNoticeMarkers", () => {
  test("holds a fixed line of the notice in each language and detail level", () => {
    expect(pausedNoticeMarkers()).toEqual([
      "Turn them on again in Settings.",
      "⏸ Automatic moves were turned off for one category",
      "Włącz je ponownie w Ustawieniach.",
      "⏸ Wyłączono automatyczne przenoszenie dla jednej kategorii",
    ]);
  });
});

const READY: SetupState = {
  mailboxA: { status: "paused" },
  mailboxAddresses: ["a@kordelan.test"],
  mailboxB: "office@kordelan.test",
  autoCategories: [],
  botTexts: ["Hello! Here is what I can do."],
  flags: { ...Object.fromEntries(DEMO_FLAGS_ON.map((flag) => [flag, true])), open_loops: false, reply_drafts: false },
  telegramLinked: true,
  quiet: { start: "00:00", end: "00:00" },
  inboxB: 27,
  historyCount: 27,
};

describe("setupProblems", () => {
  test("a ready state has no problem", () => {
    expect(setupProblems(READY)).toEqual([]);
    expect(DEMO_FLAGS_OFF).toEqual(["open_loops", "reply_drafts"]);
  });

  test.each([
    ["no mailbox A", { mailboxA: null }, "setup_a_missing"],
    ["mailbox A active", { mailboxA: { status: "active" } }, "setup_a_status active"],
    ["a category with auto on", { autoCategories: ["spam", "info"] }, "setup_auto_on spam,info"],
    ["a flag of the steps off", { flags: { ...READY.flags, trust_ladder: false } }, "setup_flag_off trust_ladder"],
    [
      "quiet hours flag unset",
      { flags: { ...READY.flags, user_quiet_hours: undefined } },
      "setup_flag_off user_quiet_hours",
    ],
    ["open_loops on", { flags: { ...READY.flags, open_loops: true } }, "setup_flag_on open_loops"],
    ["reply_drafts unknown", { flags: { ...READY.flags, reply_drafts: undefined } }, "setup_flag_on reply_drafts"],
    ["no Telegram link", { telegramLinked: false }, "setup_telegram_not_linked"],
    ["quiet hours set", { quiet: { start: "22:00", end: "07:00" } }, "setup_quiet_hours"],
    ["quiet hours not stored", { quiet: { start: null, end: null } }, "setup_quiet_hours"],
    ["a mail missing in B", { inboxB: 26 }, "setup_b_inbox 26 expected 27"],
    ["an extra mail in B", { inboxB: 28 }, "setup_b_inbox 28 expected 27"],
    ["B connected", { mailboxAddresses: ["a@kordelan.test", "Office@Kordelan.test"] }, "setup_b_connected"],
  ] as [string, Partial<SetupState>, string][])("%s", (_name, change, code) => {
    expect(setupProblems({ ...READY, ...change })).toEqual([code]);
  });

  test("an autonomy_paused notice in the chat is a problem, in each language and detail level", () => {
    for (const marker of pausedNoticeMarkers()) {
      expect(setupProblems({ ...READY, botTexts: ["hi", `line one\n${marker}`] })).toEqual([
        "setup_autonomy_paused_notice",
      ]);
    }
  });
});

describe("purgeMailboxB", () => {
  test("empties the mailbox that it is given", async () => {
    const emptied: string[] = [];
    await purgeMailboxB({ emptyMailbox: async (mailbox) => (emptied.push(mailbox), 3) }, "office@kordelan.test");
    expect(emptied).toEqual(["office@kordelan.test"]);
  });

  test("a mail error is demo_mailbox_purge_failed, any other error passes through", async () => {
    const mailError = { emptyMailbox: async () => Promise.reject(new LabMailError("imap_fetch")) };
    await expect(purgeMailboxB(mailError, "office@kordelan.test")).rejects.toThrow("demo_mailbox_purge_failed");
    const other = { emptyMailbox: async () => Promise.reject(new Error("boom")) };
    await expect(purgeMailboxB(other, "office@kordelan.test")).rejects.toThrow("boom");
  });
});

describe("liveMessages", () => {
  test("numbers the mails from firstSeq and dates each one with the delivery time", () => {
    const now = new Date("2026-12-09T12:00:00Z");
    const out = liveMessages([MAIL, { ...MAIL, subject: "Second" }], {
      to: "office@kordelan.test",
      firstSeq: 31,
      runTag: "cd34",
      now,
    });
    expect(out.map((message) => message.internalDate)).toEqual([now, now]);
    expect(out[0]?.raw).toContain("Message-ID: <demo-31.cd34@ea-seed.test>");
    expect(out[1]?.raw).toContain("Message-ID: <demo-32.cd34@ea-seed.test>");
    expect(out[1]?.raw).toContain("Subject: Second");
    expect(out[0]?.raw).toContain("Date: Wed, 09 Dec 2026 12:00:00 GMT");
  });
});

describe("hasPausedNotice", () => {
  test("is true for the notice in any language and false for other bot texts", () => {
    for (const marker of pausedNoticeMarkers()) expect(hasPausedNotice(["Welcome", `x\n${marker}`])).toBe(true);
    expect(hasPausedNotice(["Welcome", "Signature needed today"])).toBe(false);
    expect(hasPausedNotice([])).toBe(false);
  });
});
