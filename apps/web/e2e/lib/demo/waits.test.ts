import { describe, expect, test } from "bun:test";

import type { ActivityItem, ApprovalItem, DelegationItem } from "@ea/core/web";

import type { DemoMail, DemoRunPlan } from "./run-plan";
import { DEMO_WAIT_LIMITS_MS } from "./server-env";
import {
  afterTapMissing,
  delegationApproval,
  firstSynced,
  historyCheckState,
  noticeMentions,
  remindTarget,
  shadowTriaged,
  undoRowReady,
  waitUntil,
  type WaitClock,
} from "./waits";

const mail = (subject: string): DemoMail => ({
  key: subject,
  from: "sender@seed.test",
  subject,
  text: null,
  category: "info",
  at: new Date("2026-11-23T08:00:00Z"),
});

const PLAN = {
  shadow: ["S1", "S2", "S3", "S4"].map(mail),
  urgent: mail("Signature needed"),
  undo: mail("Weekly digest"),
} as unknown as DemoRunPlan;

const B = "office@kordelan.test";

const approval = (over: Partial<ApprovalItem>): ApprovalItem =>
  ({ id: "a1", mailboxAddress: B, delegationId: "d1", state: "waiting", draftReady: true, ...over }) as ApprovalItem;
const row = (over: Partial<ActivityItem>): ActivityItem =>
  ({ subject: "Weekly digest", undoable: true, undoPending: false, ...over }) as ActivityItem;
const delegation = (over: Partial<DelegationItem>): DelegationItem =>
  ({ id: "d1", status: "sent", ...over }) as DelegationItem;

describe("firstSynced", () => {
  test.each([
    { name: "B synced", list: [{ address: B, lastSyncedAt: "2026-12-09T12:00:00.000Z" }], expected: true },
    { name: "B never synced", list: [{ address: B, lastSyncedAt: null }], expected: false },
    {
      name: "only A synced",
      list: [
        { address: "a@kordelan.test", lastSyncedAt: "2026-12-09T12:00:00.000Z" },
        { address: B, lastSyncedAt: null },
      ],
      expected: false,
    },
    { name: "address case differs", list: [{ address: "Office@Kordelan.test", lastSyncedAt: "x" }], expected: true },
  ])("$name", ({ list, expected }) => {
    expect(firstSynced(list, B)).toBe(expected);
  });
});

describe("shadowTriaged", () => {
  test("needs a row for each of the 4 shadow mails", () => {
    const rows = (subjects: string[]) => subjects.map((subject) => ({ subject }));
    expect(shadowTriaged(rows(["S1", "S2", "S3", "S4", "other"]), PLAN)).toBe(true);
    expect(shadowTriaged(rows(["S1", "S2", "S3"]), PLAN)).toBe(false);
    expect(shadowTriaged([], PLAN)).toBe(false);
  });
});

describe("historyCheckState", () => {
  test.each([
    { check: null, expected: "waiting" },
    { check: { status: "classifying", noResultReason: null }, expected: "waiting" },
    { check: { status: "done", noResultReason: null }, expected: "done" },
    {
      check: { status: "no_result", noResultReason: "model_failing" },
      expected: "demo_history_no_result model_failing",
    },
  ] as const)("$check → $expected", ({ check, expected }) => {
    expect(historyCheckState(check)).toBe(expected);
  });
});

describe("noticeMentions", () => {
  test("finds the subject in a bot message with tags and entities", () => {
    expect(
      noticeMentions(["<b>Urgent</b>\nFrom: X\n<i>Terms &amp; Conditions: sign</i>"], "Terms & Conditions: sign")
    ).toBe(true);
  });
  test("is false for another message", () => {
    expect(noticeMentions(["Welcome"], "Signature needed")).toBe(false);
    expect(noticeMentions([], "Signature needed")).toBe(false);
  });
});

describe("delegationApproval", () => {
  test.each([
    { name: "the waiting delegation send with its copy", items: [approval({})], found: "a1" },
    { name: "no Drafts copy yet", items: [approval({ draftReady: false })], found: undefined },
    { name: "not a delegation send", items: [approval({ delegationId: null })], found: undefined },
    { name: "already sent", items: [approval({ state: "held" })], found: undefined },
    { name: "another mailbox", items: [approval({ mailboxAddress: "a@kordelan.test" })], found: undefined },
  ])("$name", ({ items, found }) => {
    expect(delegationApproval(items, B)?.id).toBe(found);
  });
});

describe("undoRowReady", () => {
  test.each([
    { name: "move applied", items: [row({})], expected: true },
    { name: "not undoable", items: [row({ undoable: false })], expected: false },
    { name: "undo pending", items: [row({ undoPending: true })], expected: false },
    { name: "another mail", items: [row({ subject: "Other" })], expected: false },
  ])("$name", ({ items, expected }) => {
    expect(undoRowReady(items, PLAN)).toBe(expected);
  });
});

describe("afterTapMissing", () => {
  const ready = {
    botTexts: ["<b>Signature needed</b>"],
    approvals: [approval({})],
    activity: [row({})],
  };
  test("names each of the three things that has not happened", () => {
    expect(afterTapMissing(ready, PLAN, B)).toEqual([]);
    expect(afterTapMissing({ ...ready, botTexts: [] }, PLAN, B)).toEqual(["urgent_notice"]);
    expect(afterTapMissing({ ...ready, approvals: [] }, PLAN, B)).toEqual(["delegation_send"]);
    expect(afterTapMissing({ ...ready, activity: [] }, PLAN, B)).toEqual(["undo_move"]);
    expect(afterTapMissing({ botTexts: [], approvals: [], activity: [] }, PLAN, B)).toEqual([
      "urgent_notice",
      "delegation_send",
      "undo_move",
    ]);
  });
});

describe("remindTarget (the step-7 pick of the step-6 delegation)", () => {
  test("picks the sent delegation of the step-6 send, not another row of the same delegate", () => {
    const rows = [delegation({ id: "d0", status: "overdue" }), delegation({ id: "d1" })];
    expect(remindTarget(rows, "d1")?.id).toBe("d1");
  });
  test("picks nothing while the delegation is not sent or is not in the list", () => {
    expect(remindTarget([delegation({ status: "drafted" })], "d1")).toBeUndefined();
    expect(remindTarget([delegation({ id: "d9" })], "d1")).toBeUndefined();
  });
});

describe("waitUntil", () => {
  function fakeClock(): WaitClock & { at: number } {
    const clock = {
      at: 0,
      now: () => clock.at,
      sleep: async (ms: number) => {
        clock.at += ms;
      },
    };
    return clock;
  }

  test("returns when the probe turns true, after the polls it needed", async () => {
    const clock = fakeClock();
    let calls = 0;
    await waitUntil("firstSync", async () => ++calls === 3, clock, 5000);
    expect(calls).toBe(3);
    expect(clock.at).toBe(10_000);
  });

  test("fails with the code and the name of the wait at its limit, after a last probe", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = waitUntil("delegationSent", async () => (calls += 1) < 0, clock, 5000);
    await expect(result).rejects.toThrow("demo_wait_timeout delegationSent");
    expect(clock.at).toBe(DEMO_WAIT_LIMITS_MS.delegationSent);
    expect(calls).toBe(DEMO_WAIT_LIMITS_MS.delegationSent / 5000 + 1);
  });

  test("ends at once with the error of a probe that throws", async () => {
    const clock = fakeClock();
    const result = waitUntil(
      "historyDone",
      async () => {
        throw new Error("demo_history_no_result model_failing");
      },
      clock
    );
    await expect(result).rejects.toThrow("demo_history_no_result model_failing");
    expect(clock.at).toBe(0);
  });
});
