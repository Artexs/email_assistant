import { describe, expect, test } from "bun:test";

import {
  delegationRow,
  handledRow,
  hiddenMoveRow,
  loopRow,
  mistakeRow,
  rejectRow,
  truthRow,
  urgentRow,
} from "./fixtures";

const numberOf = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));

describe("hiddenMoveRow", () => {
  test("a row with no override holds the default moved mail", () => {
    expect(hiddenMoveRow()).toEqual({
      emailId: expect.stringMatching(/^mail-\d+$/),
      appliedAt: new Date("2026-11-17T10:00:00Z"),
      folder: "ai_info",
      truth: null,
      vip: false,
      whitelisted: false,
    });
  });

  test("an override replaces its field and leaves the others", () => {
    expect(hiddenMoveRow({ emailId: "mail-x", vip: true, whitelisted: true, truth: "urgent" })).toEqual({
      emailId: "mail-x",
      appliedAt: new Date("2026-11-17T10:00:00Z"),
      folder: "ai_info",
      truth: "urgent",
      vip: true,
      whitelisted: true,
    });
  });

  test("each row gets the next id", () => {
    const first = hiddenMoveRow().emailId;
    const second = hiddenMoveRow().emailId;
    expect(numberOf(second)).toBe(numberOf(first) + 1);
  });
});

describe("the other row builders", () => {
  test("a truth row is an unlabelled info mail", () => {
    expect(truthRow()).toEqual({
      emailId: expect.stringMatching(/^mail-\d+$/),
      predicted: "info",
      truth: null,
      truthSource: null,
      wrongOnly: false,
    });
  });

  test("a loop row is a waiting loop with a due time and nothing else set", () => {
    expect(loopRow()).toEqual({
      id: expect.stringMatching(/^loop-\d+$/),
      kind: "waiting",
      dueAt: new Date("2026-11-17T09:00:00Z"),
      surfacedAt: null,
      closedAt: null,
      closeReason: null,
      firstFollowUpAt: null,
    });
  });

  test("a delegation row is a sent, open, uncancelled delegation", () => {
    expect(delegationRow()).toEqual({
      id: expect.stringMatching(/^delegation-\d+$/),
      sentAt: new Date("2026-11-10T09:00:00Z"),
      dueAt: null,
      answeredAt: null,
      doneAt: null,
      overdueAt: null,
      cancelled: false,
    });
  });

  test("a reject row and a mistake row hold an action id and a time", () => {
    expect(rejectRow()).toEqual({
      actionId: expect.stringMatching(/^action-\d+$/),
      rejectedAt: new Date("2026-11-17T10:00:00Z"),
      reason: null,
    });
    expect(mistakeRow()).toEqual({
      actionId: expect.stringMatching(/^action-\d+$/),
      sentAt: new Date("2026-11-17T10:00:00Z"),
    });
  });

  test("a handled row is an info mail with every flag off", () => {
    expect(handledRow()).toEqual({
      emailId: expect.stringMatching(/^mail-\d+$/),
      category: "info",
      mailboxActionApplied: false,
      mailboxActionUndone: false,
      mailboxActionLogged: false,
      wrongWithin7Days: false,
      delegationSendApplied: false,
      delegationCancelled: false,
    });
  });

  test("an urgent row has a mail id, its time and no notice", () => {
    expect(urgentRow()).toEqual({
      emailId: expect.stringMatching(/^mail-\d+$/),
      receivedAt: new Date("2026-11-17T09:00:00Z"),
      noticeAt: null,
    });
  });
});
