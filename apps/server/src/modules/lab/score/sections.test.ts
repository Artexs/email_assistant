import type { DelegateBehaviour } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { LabEvent } from "../state";

import {
  botCountsOf,
  firstChaserRunAfter,
  reminderReachable,
  renderDelegates,
  scoreDelegates,
  type DelegateObservation,
} from "./delegates";
import { renderExecutive, scoreExecutive } from "./executive";
import { renderLimits, scoreLimits } from "./limits";
import { costSection, renderMetrics, type MetricsSection } from "./metrics";
import { renderPhishing, scorePhishing, type PhishingObservation } from "./phishing";
import { renderLabReport, type LabScore } from "./report";
import { scoreM1, scoreTriage } from "./triage";

const m7 = {
  llmUsdWeek: 0.0006,
  llmCalls: 3,
  unpricedCalls: 0,
  mailboxes: 1,
  hostingUsdMonth: 0.355,
  backupUsdMonth: 0.05,
  perMailboxMonthUsd: 0.407571,
  targetUsd: 5,
};

let counter = 0;
function delegation(behaviour: DelegateBehaviour, over: Partial<DelegateObservation> = {}): DelegateObservation {
  counter += 1;
  return {
    slotId: `w-${behaviour}-${counter}`,
    behaviour,
    sent: true,
    answered: false,
    answeredByAuto: false,
    reminders: 0,
    overdue: false,
    reminderReachable: true,
    ...over,
  };
}
const row = (rows: ReturnType<typeof scoreDelegates>, behaviour: DelegateBehaviour) =>
  rows.rows.find((candidate) => candidate.behaviour === behaviour) as ReturnType<typeof scoreDelegates>["rows"][number];

describe("delegates table (stage 13 tests 1 and 2)", () => {
  test("1: done planned 4, answered 4 is ok; late planned 2, answered 1 with 1 reminder, 1 unanswered shows 1 that differs", () => {
    const section = scoreDelegates(
      [
        ...[1, 2, 3, 4].map(() => delegation("done", { answered: true })),
        delegation("late", { answered: true, reminders: 1, overdue: true }),
        delegation("late", { reminders: 1, overdue: true }),
      ],
      []
    );
    expect(row(section, "done")).toMatchObject({ planned: 4, sent: 4, answered: 4, differ: 0 });
    expect(row(section, "late")).toMatchObject({
      planned: 2,
      sent: 2,
      answered: 1,
      reminders: 2,
      overdue: 2,
      differ: 1,
    });
    const text = renderDelegates(section).join("\n");
    expect(text).toContain("| done | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | ok |");
    expect(text).toContain("| late | 2 | 2 | 1 | 0 | 2 | 2 | 0 | 0 | 1 differ |");
  });

  test("late expects a reminder: answered with no reminder differs, and so does a reminder with no answer", () => {
    const section = scoreDelegates(
      [
        delegation("late", { answered: true, reminders: 1 }),
        delegation("late", { answered: true, reminders: 0 }),
        delegation("late", { answered: false, reminders: 1 }),
      ],
      []
    );
    expect(row(section, "late")).toMatchObject({ planned: 3, answered: 2, reminders: 2, differ: 2 });
  });

  test("2: other_address answered 1 is a finding for E5b; not answered is ok", () => {
    const flagged = scoreDelegates([delegation("other_address", { answered: true }), delegation("other_address")], []);
    expect(row(flagged, "other_address")).toMatchObject({ planned: 2, answered: 1, differ: 1, finding: true });
    expect(renderDelegates(flagged).join("\n")).toContain("finding: 1 answered (E5b)");
    const quiet = scoreDelegates([delegation("other_address")], []);
    expect(renderDelegates(quiet).join("\n")).toContain("| other_address | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ok |");
  });

  test("out_of_office and silent expect no answer and a reminder; an answer by an auto-reply is counted apart and differs", () => {
    const section = scoreDelegates(
      [
        delegation("out_of_office", { reminders: 1 }),
        delegation("out_of_office", { answered: true, answeredByAuto: true }),
        delegation("silent", { reminders: 2, overdue: true }),
        delegation("silent"),
      ],
      []
    );
    expect(row(section, "out_of_office")).toMatchObject({ answered: 1, answeredByAuto: 1, reminders: 1, differ: 1 });
    expect(row(section, "silent")).toMatchObject({ reminders: 2, overdue: 1, differ: 1 });
  });

  test("a delegation whose reminder is not reachable goes to its own column and is never a mismatch; never sent is apart", () => {
    const section = scoreDelegates(
      [
        delegation("silent", { reminderReachable: false }),
        delegation("late", { reminderReachable: false }),
        delegation("done", { answered: true, reminderReachable: false }),
        delegation("silent", { sent: false }),
      ],
      []
    );
    expect(row(section, "silent")).toMatchObject({
      planned: 2,
      sent: 1,
      neverSent: 1,
      reminderNotReachable: 1,
      differ: 0,
    });
    expect(row(section, "late")).toMatchObject({ reminderNotReachable: 1, differ: 0 });
    // `done` expects no reminder: reachability does not apply.
    expect(row(section, "done")).toMatchObject({ reminderNotReachable: 0, differ: 0 });
  });

  test("T5: the first chaser run is the next 07:30 Warsaw after the due time; reachable when it plus 2 h is before the tail end", () => {
    // Wed 2026-12-02 10:00 Warsaw (09:00Z): the run is Thu 07:30 Warsaw (06:30Z).
    expect(firstChaserRunAfter(new Date("2026-12-02T09:00:00Z")).toISOString()).toBe("2026-12-03T06:30:00.000Z");
    // Due before 07:30: the same day. Due at exactly 07:30: the next day (the chaser needs a passed due time).
    expect(firstChaserRunAfter(new Date("2026-12-02T05:00:00Z")).toISOString()).toBe("2026-12-02T06:30:00.000Z");
    expect(firstChaserRunAfter(new Date("2026-12-02T06:30:00Z")).toISOString()).toBe("2026-12-03T06:30:00.000Z");
    // The tail of a week run starting 2026-11-23 ends Fri 2026-12-04 00:00 Warsaw (12-03T23:00Z).
    const tailEnd = new Date("2026-12-03T23:00:00Z");
    expect(reminderReachable(new Date("2026-12-02T09:00:00Z"), tailEnd)).toBe(true);
    expect(reminderReachable(new Date("2026-12-03T09:00:00Z"), tailEnd)).toBe(false);
    // The 2 h for the tap count: a run at 06:30Z with the tail ending at 08:00Z is not reachable, at 08:31Z it is.
    expect(reminderReachable(new Date("2026-12-02T09:00:00Z"), new Date("2026-12-03T08:00:00Z"))).toBe(false);
    expect(reminderReachable(new Date("2026-12-02T09:00:00Z"), new Date("2026-12-03T08:31:00Z"))).toBe(true);
  });

  test("bot skips (send_failed, auto_submitted), errors, replies and unmapped of a bot are counted; executive and injector skips are not", () => {
    const events: LabEvent[] = [
      { t: "bot_done", key: "k1", messageId: "<r.1@x>" },
      { t: "bot_done", key: "k2", messageId: "<r.2@x>" },
      { t: "bot_error", key: "k3", code: "smtp_failed" },
      { t: "bot_error", key: "k3", code: "smtp_failed" },
      { t: "skip", code: "send_failed", ref: "k3" },
      { t: "skip", code: "auto_submitted", ref: "ksiegowa:4" },
      { t: "skip", code: "auto_submitted", ref: "asystentka:7" },
      { t: "skip", code: "unexpected_delegation", ref: "ksiegowa:5" },
      { t: "skip", code: "unmapped", ref: "ksiegowa:6" },
      // A UID that held another mail at send time (a mailbox reset between).
      { t: "skip", code: "received_changed", ref: "k4" },
      // Not bot events: an executive unmapped (digits), an executive no_rule, an injector skip.
      { t: "skip", code: "unmapped", ref: "17:abc" },
      { t: "skip", code: "unmapped", ref: "rw:17:abc" },
      { t: "skip", code: "no_rule", ref: "18:abc" },
      { t: "skip", code: "smtp_failed", ref: "w-1-001" },
    ];
    expect(botCountsOf(events)).toEqual({
      replies: 2,
      errors: 2,
      skips: { send_failed: 1, auto_submitted: 2, unexpected_delegation: 1, unmapped: 1, received_changed: 1 },
    });
    const section = scoreDelegates([], events);
    expect(section).toMatchObject({ unexpectedDelegation: 1, unmapped: 1 });
    const text = renderDelegates(section).join("\n");
    expect(text).toContain("Bot replies sent 2, failed tries 2. Unexpected delegation 1, unmapped 1.");
    expect(text).toContain(
      "Bot skips: auto_submitted 2, received_changed 1, send_failed 1, unexpected_delegation 1, unmapped 1."
    );
  });
});

describe("send limits (stage 13 test 3)", () => {
  test("3: 2 recipient_day rows print recipient day 2; no rows print no send limit reached", () => {
    const hit = scoreLimits(new Map([["recipient_day", 2]]), 1);
    expect(hit).toEqual({ hits: { mailbox_hour: 0, mailbox_day: 0, recipient_day: 2 }, total: 2, heldAtEnd: 1 });
    const text = renderLimits(hit).join("\n");
    expect(text).toContain("Send limit hits 2: mailbox hour 0, mailbox day 0, recipient day 2.");
    expect(text).toContain("held by a limit when the report was scored: 1.");
    const none = scoreLimits(new Map(), 0);
    expect(renderLimits(none).join("\n")).toContain("no send limit reached");
    expect(renderLimits(none).join("\n")).not.toContain("recipient day");
    // A key that is no limit kind counts nowhere.
    expect(scoreLimits(new Map([["other", 5]]), 0).total).toBe(0);
  });
});

describe("phishing (stage 13 test 4)", () => {
  const slot = (id: string, over: Partial<PhishingObservation> = {}): PhishingObservation => ({
    slotId: id,
    tags: ["phishing_urgent_push"],
    injected: true,
    triagedUrgent: false,
    noticed: false,
    warned: false,
    ...over,
  });

  test("4: 5 injected, 2 urgent notices, no warning field says so and counts unwarned urgent push 2", () => {
    const rows = [
      slot("p1", { triagedUrgent: true, noticed: true }),
      slot("p2", { triagedUrgent: true, noticed: true }),
      slot("p3", { triagedUrgent: true }),
      slot("p4"),
      slot("p5"),
    ];
    const section = scorePhishing(rows, false);
    expect(section).toMatchObject({ injected: 5, triagedUrgent: 3, noticed: 2, warned: 0, unwarnedUrgentPush: 2 });
    const text = renderPhishing(section).join("\n");
    expect(text).toContain("notice with a warning: no warning field.");
    expect(text).toContain("Unwarned urgent push 2");
    expect(text).toContain("| phishing_urgent_push | 5 | 3 | 2 | no warning field |");
  });

  test("with a warning field the warned notices are not unwarned; a slot with two tags counts once in the total", () => {
    const rows = [
      slot("p1", { triagedUrgent: true, noticed: true, warned: true }),
      slot("p2", { triagedUrgent: true, noticed: true }),
      slot("p3", { tags: ["phishing_delegation", "phishing_unsubscribe"], injected: true }),
    ];
    const section = scorePhishing(rows, true);
    expect(section).toMatchObject({ injected: 3, triagedUrgent: 2, noticed: 2, warned: 1, unwarnedUrgentPush: 1 });
    expect(section.byTag.phishing_urgent_push).toEqual({ injected: 2, triagedUrgent: 2, noticed: 2, warned: 1 });
    expect(section.byTag.phishing_delegation).toEqual({ injected: 1, triagedUrgent: 0, noticed: 0, warned: 0 });
    expect(renderPhishing(section).join("\n")).toContain("| phishing_urgent_push | 2 | 2 | 2 | 1 |");
  });

  test("a slot that was not injected is not counted", () => {
    expect(scorePhishing([slot("p1", { injected: false })], true)).toMatchObject({ injected: 0 });
  });
});

describe("executive table (stage 13 test 8)", () => {
  const press = (key: string, data: string, then?: "p" | "n"): LabEvent[] => [
    {
      t: "tap_planned",
      key,
      at: "2026-11-23T09:00:00.000Z",
      data,
      messageId: 1,
      ...(then === undefined ? {} : { then }),
    },
    { t: "tap_intent", key, data },
    { t: "tap_done", key, data },
  ];

  test("8: 3 approve, 1 reject with reason p, 1 Undo, 1 unmapped, expired approvals without a tap", () => {
    const events: LabEvent[] = [
      ...press("1:ap:a", "ap:a"),
      ...press("2:ap:b", "ap:b"),
      ...press("3:ap:c", "ap:c"),
      ...press("4:ar:d", "ar:d", "p"),
      ...press("4:rw:p:d", "rw:p:d"),
      ...press("5:fu:e", "fu:e"),
      { t: "skip", code: "unmapped", ref: "6:f" },
      // A bot unmapped is not an executive one.
      { t: "skip", code: "unmapped", ref: "ksiegowa:9" },
      { t: "skip", code: "no_rule", ref: "7:g" },
      { t: "skip", code: "no_rule", ref: "8:h" },
      { t: "skip", code: "tap_unsure", ref: "9:ap:i" },
      { t: "skip", code: "fake_restarted", ref: "4242" },
      { t: "tap_planned", key: "10:ap:j", at: "2026-11-23T09:00:00.000Z", data: "ap:j", messageId: 10 },
    ];
    const section = scoreExecutive(events, [
      { id: "x1", reason: "timeout" },
      { id: "x2", reason: "timeout" },
      { id: "x3", reason: "not_notified" },
    ]);
    expect(section.presses).toEqual({
      approve: 3,
      reject_wrong_person: 1,
      reject_not_needed: 0,
      reject_no_reason: 0,
      reason_pick: 1,
      approve_set: 0,
      undo: 1,
      send_again: 0,
      other: 0,
    });
    expect(section).toMatchObject({
      pressed: 6,
      planned: 7,
      unmapped: 1,
      noRule: 2,
      tapUnsure: 1,
      tapGone: 0,
      fakeRestarted: 1,
      approvalsExpired: { total: 3, byReason: { timeout: 2, not_notified: 1 } },
    });
    const text = renderExecutive(section).join("\n");
    expect(text).toContain("| approve | 3 |");
    expect(text).toContain("| reject_wrong_person | 1 |");
    expect(text).toContain("| undo | 1 |");
    expect(text).toContain("Cards with no mapped mail (unmapped) 1, no rule 2, tap unsure 1");
    expect(text).toContain("Approvals expired without a tap: 3 (not_notified 1, timeout 2).");
  });

  test("a reject with the other reason, a set approval and send again land in their own rules", () => {
    const section = scoreExecutive(
      [
        ...press("a", "ar:1", "n"),
        ...press("b", "as:2"),
        ...press("c", "ag:3"),
        ...press("d", "ar:4"),
        ...press("e", "zz:5"),
      ],
      []
    );
    expect(section.presses).toMatchObject({
      reject_not_needed: 1,
      approve_set: 1,
      send_again: 1,
      reject_no_reason: 1,
      other: 1,
    });
    expect(section.approvalsExpired).toEqual({ total: 0, byReason: {} });
    expect(renderExecutive(section).join("\n")).toContain("Approvals expired without a tap: 0.");
  });
});

describe("M7 cost section and metrics render (stage 13 test 6, pure part)", () => {
  test("a day run has the total and the cost per mail, and says the month figure needs a week run", () => {
    // 0.0006 USD over 3 mails: 0.0002 per mail.
    const cost = costSection("day", { m7, tailLlm: null }, 3);
    expect(cost).toMatchObject({ usd: 0.0006, calls: 3, perMailboxMonthUsd: null, tail: null });
    expect(cost.usdPerMail).toBeCloseTo(0.0002, 10);
    expect(costSection("day", { m7, tailLlm: null }, 0).usdPerMail).toBeNull();
  });

  test("a week run keeps the month figure of the 7 run days and the tail cost apart", () => {
    const cost = costSection("week", { m7, tailLlm: { usd: 0.0002, calls: 1, unpricedCalls: 0 } }, 3);
    expect(cost).toMatchObject({ perMailboxMonthUsd: 0.407571, tail: { usd: 0.0002, calls: 1 } });
  });

  const metrics = (mode: "day" | "week"): MetricsSection => ({
    mode,
    window: { start: "2026-11-22T23:00:00.000Z", end: "2026-12-03T23:00:00.000Z" },
    m2: { due: 2, closedOnTime: 1, surfacedOnTime: 1, pending: 0 },
    m3: { hiddenImportant: 1, wrongPerson: 2, wrongContent: 0, sentMistake: 0, total: 3, notNeeded: 4, noReason: 0 },
    m4: { triaged: 8, handled: 2, wouldHandle: 1 },
    m5: { urgent: 4, noticed: 3, withoutNotice: 1, quietHours: 2, p90Minutes: 12.5 },
    m5Late: ["w-1-002"],
    m7: costSection(mode, { m7, tailLlm: { usd: 0.0002, calls: 1, unpricedCalls: 0 } }, 3),
  });

  test("the render holds the rates of M2 and M4, the M5 line with the late slots, and the cost lines of the mode", () => {
    const week = renderMetrics(metrics("week")).join("\n");
    expect(week).toContain("closed on time 1 (50.0 %), surfaced on time 1 (50.0 %), not decided yet 0");
    expect(week).toContain("| 1 | 2 | 0 | 0 | 3 | 4 | 0 |");
    expect(week).toContain("Triaged 8, handled 2 (25.0 %), would handle in shadow 1.");
    expect(week).toContain("p90 12.5 min");
    expect(week).toContain("Late injections of urgent mail (1): w-1-002.");
    expect(week).toContain(
      "Month figure per mailbox (7 run days scaled by the core cost metric): $0.4076; target $5.0000."
    );
    expect(week).toContain("Tail cost (after the run days, not in the month figure): $0.0002 in 1 calls");
    const day = renderMetrics(metrics("day")).join("\n");
    expect(day).toContain("Month figure per mailbox: needs a week run.");
    expect(day).not.toContain("Tail cost");
  });

  test("M2 with nothing due shows n/a, not a division by zero", () => {
    const empty = { ...metrics("day"), m2: { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 } };
    expect(renderMetrics(empty).join("\n")).toContain("closed on time 0 (n/a)");
  });
});

describe("the report renders every section and holds no mail text", () => {
  test("renderLabReport prints the five sections after the stage 12 ones, in order; the JSON holds them", () => {
    const rows = [
      { slotId: "w-1-001", emailId: "e1", predicted: "info" as const, truth: "info" as const, hardCases: [] },
    ];
    const score: LabScore = {
      header: {
        runId: "week-20261123-0a1b",
        mode: "week",
        partial: false,
        startDate: "2026-11-23",
        offsetDays: 91,
        corpusId: "lab-01",
        corpusVersion: "1",
        manifestHash: "ab".repeat(32),
        auditStatus: "pending",
        models: [],
        capUsd: 5,
        spendUsd: 0,
        spendUnpriced: false,
        stopReason: "done",
        scoredAt: "2026-12-05T10:00:00.000Z",
      },
      triage: scoreTriage(rows),
      m1: scoreM1(rows),
      sections: {
        metrics: {
          mode: "week",
          window: { start: "a", end: "b" },
          m2: { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 },
          m3: {
            hiddenImportant: 0,
            wrongPerson: 0,
            wrongContent: 0,
            sentMistake: 0,
            total: 0,
            notNeeded: 0,
            noReason: 0,
          },
          m4: { triaged: 0, handled: 0, wouldHandle: 0 },
          m5: { urgent: 0, noticed: 0, withoutNotice: 0, quietHours: 0, p90Minutes: null },
          m5Late: [],
          m7: costSection("week", { m7, tailLlm: null }, 0),
        },
        delegates: scoreDelegates([delegation("done", { answered: true })], []),
        executive: scoreExecutive([], []),
        limits: scoreLimits(new Map(), 0),
        phishing: scorePhishing([], false),
      },
    };
    const { markdown, json } = renderLabReport(score);
    const at = [
      "## Triage",
      "## M1",
      "## Metrics M2 to M5, M7",
      "## Delegates",
      "## Executive",
      "## Send limits",
      "## Phishing",
    ].map((heading) => markdown.indexOf(heading));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const sections = (JSON.parse(json) as LabScore).sections;
    expect(Object.keys(sections)).toEqual(["metrics", "delegates", "executive", "limits", "phishing"]);
    expect(markdown).not.toMatch(/@[a-z0-9.-]+\.test/);
  });
});
