import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SEND_LIMITS,
  checkSendLimits,
  sendLimitError,
  sendLimitKinds,
  sendLimitOfError,
  type RecentSend,
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
const held = (limit: string, until: string) => ({ kind: "held", limit, until: new Date(until) });

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

describe("send limit error text", () => {
  test("15: round trip and rejects other text", () => {
    expect(sendLimitError("mailbox_day")).toBe("send_limit:mailbox_day");
    for (const kind of sendLimitKinds) expect(sendLimitOfError(sendLimitError(kind))).toBe(kind);
    for (const text of [null, "send_limit", "send_limit:other", "smtp_421"]) {
      expect(sendLimitOfError(text)).toBeNull();
    }
  });
});
