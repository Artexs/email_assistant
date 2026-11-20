import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SEND_LIMITS,
  checkSendLimits,
  sendLimitError,
  sendLimitKinds,
  sendLimitOfError,
  type RecentSend,
  type SendLimitKind,
  type SendLimitResult,
  type SendLimits,
} from "./send-limits";

const NOW = new Date("2026-11-20T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

const r = (offsetMs: number, to: readonly string[] = ["x@x.test"]): RecentSend => ({
  startedAt: new Date(NOW.getTime() + offsetMs),
  to,
});
const range = (fromMin: number, count: number, to?: readonly string[]): RecentSend[] =>
  Array.from({ length: count }, (_, i) => r((fromMin + i) * MIN, to));
const fiveToA = [-10, -8, -6, -4, -2].map((h) => r(h * HOUR, ["a@x.test"]));
const twentyInHour = range(-50, 20);

function check(recent: RecentSend[], to: string[] = ["n@x.test"], limits: SendLimits = DEFAULT_SEND_LIMITS, now = NOW) {
  return checkSendLimits({ now, recent, to, limits });
}
const held = (limit: SendLimitKind, until: string): SendLimitResult => ({
  kind: "held",
  limit,
  until: new Date(until),
});

describe("checkSendLimits, the one address rule (F142)", () => {
  test("01-T1 guard: one recipient in three Greek spellings fills the recipient window", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const at = (minutes: number, to: string) => ({ startedAt: new Date(now.getTime() - minutes * MIN), to: [to] });
    const recent = [...[5, 10, 15, 20].map((m) => at(m, "νίκος@example.gr")), at(25, "ΝΊΚΟΣ@example.gr")];
    const result = checkSendLimits({ now, recent, to: ["νίκοσ@example.gr"], limits: DEFAULT_SEND_LIMITS });
    expect(result.kind === "held" && result.limit).toBe("recipient_day");
  });
});

describe("checkSendLimits", () => {
  test("1: 19 sends in the hour pass", () => {
    expect(check(range(-59, 19))).toEqual({ kind: "ok" });
  });

  test("2: 20 sends in the hour hold until the oldest leaves", () => {
    expect(check(twentyInHour)).toEqual(held("mailbox_hour", "2026-11-20T10:10:00.000Z"));
  });

  test("3: a send exactly one window old does not count", () => {
    expect(check([r(-60 * MIN), ...range(-50, 19)])).toEqual({ kind: "ok" });
  });

  test("4: 100 sends in 24 h hold the mailbox for the day", () => {
    const recent = Array.from({ length: 100 }, (_, i) => r(-23 * HOUR + i * 13 * MIN));
    expect(check(recent)).toEqual(held("mailbox_day", "2026-11-20T11:00:00.000Z"));
  });

  test("5: 5 sends to one address hold a 6th, trimmed and lower-cased", () => {
    expect(check(fiveToA, [" A@X.test "])).toEqual(held("recipient_day", "2026-11-21T00:00:00.000Z"));
  });

  test("6: another address passes", () => {
    expect(check(fiveToA, ["b@x.test"])).toEqual({ kind: "ok" });
  });

  test("7: the later until wins", () => {
    expect(check([...fiveToA, ...twentyInHour], ["a@x.test"])).toEqual(
      held("recipient_day", "2026-11-21T00:00:00.000Z")
    );
  });

  test("8: a custom limit applies", () => {
    expect(check([r(-59 * MIN)], ["n@x.test"], { ...DEFAULT_SEND_LIMITS, mailboxHour: 1 })).toEqual(
      held("mailbox_hour", "2026-11-20T10:01:00.000Z")
    );
  });

  test("9: one held address among several holds the send", () => {
    const fiveToB = [-10, -8, -6, -4, -2].map((h) => r(h * HOUR, ["b@x.test"]));
    const result = check(fiveToB, ["a@x.test", "b@x.test"]);
    expect(result.kind).toBe("held");
    expect(result.kind === "held" && result.limit).toBe("recipient_day");
  });

  test("10: a send with an empty `to` counts for the mailbox", () => {
    const result = check(range(-50, 20, []));
    expect(result.kind === "held" && result.limit).toBe("mailbox_hour");
  });

  test("11: the window passes at the until time", () => {
    expect(check(twentyInHour, ["n@x.test"], DEFAULT_SEND_LIMITS, new Date("2026-11-20T10:10:00Z"))).toEqual({
      kind: "ok",
    });
  });

  test("12: nothing recent passes", () => {
    expect(check([], [])).toEqual({ kind: "ok" });
  });

  test("13: the later until wins; on a tie the earlier kind wins", () => {
    expect(check([r(-30 * MIN)], ["n@x.test"], { mailboxHour: 1, mailboxDay: 1, recipientDay: 5 })).toEqual(
      held("mailbox_day", "2026-11-21T09:30:00.000Z")
    );
    expect(
      check([r(-30 * MIN, ["n@x.test"])], ["n@x.test"], { mailboxHour: 20, mailboxDay: 1, recipientDay: 1 })
    ).toEqual(held("mailbox_day", "2026-11-21T09:30:00.000Z"));
  });

  test("14: a send in the future counts", () => {
    expect(check([r(5 * MIN)], ["n@x.test"], { ...DEFAULT_SEND_LIMITS, mailboxHour: 1 })).toEqual(
      held("mailbox_hour", "2026-11-20T11:05:00.000Z")
    );
  });

  test("never returns an until at or before now", () => {
    const result = check(range(-59, 20));
    expect(result.kind === "held" && result.until.getTime() > NOW.getTime()).toBe(true);
  });
});

describe("checkSendLimits until time of a full window", () => {
  // Cap 3 per hour: the window passes when the oldest of the counted sends that fill it leaves.
  const cap3: SendLimits = { mailboxHour: 3, mailboxDay: 100, recipientDay: 100 };
  const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);
  const sendAt = (hhmm: string, to: readonly string[] = ["x@x.test"]): RecentSend => ({ startedAt: at(hhmm), to });
  const now0930 = at("09:30");

  test("three sends at 09:00, 09:10 and 09:20 hold until 10:00", () => {
    expect(check([sendAt("09:00"), sendAt("09:10"), sendAt("09:20")], ["n@x.test"], cap3, now0930)).toEqual(
      held("mailbox_hour", "2026-11-20T10:00:00.000Z")
    );
  });

  test("the same sends in any order hold until the same time", () => {
    const expected = held("mailbox_hour", "2026-11-20T10:00:00.000Z");
    expect(check([sendAt("09:20"), sendAt("09:00"), sendAt("09:10")], ["n@x.test"], cap3, now0930)).toEqual(expected);
    expect(check([sendAt("09:10"), sendAt("09:20"), sendAt("09:00")], ["n@x.test"], cap3, now0930)).toEqual(expected);
  });

  test("two sends do not fill a cap of three", () => {
    expect(check([sendAt("09:00"), sendAt("09:10")], ["n@x.test"], cap3, now0930)).toEqual({ kind: "ok" });
  });

  test("more sends than the cap: the window passes when the oldest one that must leave has left", () => {
    const sends = [sendAt("09:35"), sendAt("09:05"), sendAt("09:15"), sendAt("09:25"), sendAt("09:45")];
    // Counted at 09:50: all five. The window holds 3 once the two oldest (09:05, 09:15) are gone: at 09:25 + 1 h.
    expect(check(sends, ["n@x.test"], cap3, at("09:50"))).toEqual(held("mailbox_hour", "2026-11-20T10:25:00.000Z"));
  });

  test("a cap of one holds until the one send leaves", () => {
    const one: SendLimits = { mailboxHour: 1, mailboxDay: 100, recipientDay: 100 };
    expect(check([sendAt("09:20")], ["n@x.test"], one, now0930)).toEqual(
      held("mailbox_hour", "2026-11-20T10:20:00.000Z")
    );
  });

  test("the recipient window uses the same rule over the sends to that address, in any order", () => {
    const limits: SendLimits = { mailboxHour: 100, mailboxDay: 100, recipientDay: 2 };
    const recent = [sendAt("09:20", ["a@x.test"]), sendAt("09:00", ["a@x.test"]), sendAt("09:10", ["b@x.test"])];
    expect(check(recent, ["a@x.test"], limits, now0930)).toEqual(held("recipient_day", "2026-11-21T09:00:00.000Z"));
    expect(check(recent, ["b@x.test"], limits, now0930)).toEqual({ kind: "ok" });
  });
});

describe("send limit error text", () => {
  test("15: round trip and rejects other text", () => {
    expect(sendLimitError("mailbox_day")).toBe("send_limit:mailbox_day");
    for (const kind of sendLimitKinds) expect(sendLimitOfError(sendLimitError(kind))).toBe(kind);
    for (const text of [null, "send_limit", "send_limit:other", "smtp_421"]) {
      expect(sendLimitOfError(text)).toBeNull();
    }
  });
});
