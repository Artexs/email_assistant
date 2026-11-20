import { describe, expect, test } from "bun:test";

import { renderOperatorEvent } from "./alert-text";
import { operatorEventKey, type OperatorEvent } from "./events";
import { ALERT_LIFECYCLE, OPERATOR_ALERT_KINDS, OPERATOR_EVENT_KINDS, SLO_KINDS } from "./kinds";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const AT = new Date("2026-11-18T10:00:00.000Z");
const UNTIL = new Date("2026-11-18T10:10:00.000Z");
const ISO_AT = "2026-11-18T10:00:00.000Z";
const ISO_UNTIL = "2026-11-18T10:10:00.000Z";

describe("operatorEventKey", () => {
  test.each<[string, OperatorEvent, string]>([
    [
      "trial_ending, not ended",
      { kind: "trial_ending", orgId: ORG, endsAt: AT, ended: false },
      `trial_ending:${ORG}:1794996000000`,
    ],
    [
      "trial_ending, ended: the same key",
      { kind: "trial_ending", orgId: ORG, endsAt: AT, ended: true },
      `trial_ending:${ORG}:1794996000000`,
    ],
    [
      "auth_error_24h",
      { kind: "auth_error_24h", orgId: ORG, mailboxId: BOX, since: AT },
      `auth_error_24h:${BOX}:1794996000000`,
    ],
    ["llm_cap", { kind: "llm_cap", orgId: ORG, mailboxId: BOX, cap: 300, dayStart: AT }, `llm_cap:${BOX}:${ISO_AT}`],
    [
      "auth_mail_failed",
      {
        kind: "auth_mail_failed",
        orgId: ORG,
        userId: USER,
        mail: "reset",
        code: "EAUTH",
        at: new Date("2026-11-18T23:59:59.000Z"),
      },
      `auth_mail_failed:${USER}:EAUTH:2026-11-18`,
    ],
    [
      "send_limit",
      { kind: "send_limit", orgId: ORG, mailboxId: BOX, limit: "mailbox_hour", at: AT, until: UNTIL },
      `send_limit:${BOX}:2026-11-18`,
    ],
  ])("%s", (_name, event, key) => {
    expect(operatorEventKey(event)).toBe(key);
  });
});

describe("renderOperatorEvent", () => {
  test.each<[string, OperatorEvent, "en" | "pl", string]>([
    [
      "trial ends",
      { kind: "trial_ending", orgId: ORG, endsAt: AT, ended: false },
      "en",
      `Trial of org ${ORG} ends ${ISO_AT}.`,
    ],
    [
      "trial ended",
      { kind: "trial_ending", orgId: ORG, endsAt: AT, ended: true },
      "en",
      `Trial of org ${ORG} ended ${ISO_AT}.`,
    ],
    [
      "auth error",
      { kind: "auth_error_24h", orgId: ORG, mailboxId: BOX, since: AT },
      "en",
      `Mailbox ${BOX} of org ${ORG} has been in auth_error since ${ISO_AT}.`,
    ],
    [
      "llm cap 300",
      { kind: "llm_cap", orgId: ORG, mailboxId: BOX, cap: 300, dayStart: AT },
      "en",
      `Mailbox ${BOX} of org ${ORG} reached the daily LLM cap (300 calls) on the quota day from ${ISO_AT}.`,
    ],
    [
      "auth mail reset",
      { kind: "auth_mail_failed", orgId: ORG, userId: USER, mail: "reset", code: "EAUTH", at: AT },
      "en",
      `Auth mail reset to user ${USER} of org ${ORG} failed (EAUTH).`,
    ],
    [
      "send limit",
      { kind: "send_limit", orgId: ORG, mailboxId: BOX, limit: "mailbox_hour", at: AT, until: UNTIL },
      "en",
      `Mailbox ${BOX} of org ${ORG} hit the send limit mailbox_hour at ${ISO_AT}; its sends wait until ${ISO_UNTIL}.`,
    ],
    [
      "trial ended (pl)",
      { kind: "trial_ending", orgId: ORG, endsAt: AT, ended: true },
      "pl",
      `Okres próbny organizacji ${ORG} zakończył się ${ISO_AT}.`,
    ],
    [
      "llm cap 3 (pl)",
      { kind: "llm_cap", orgId: ORG, mailboxId: BOX, cap: 3, dayStart: AT },
      "pl",
      `Skrzynka ${BOX} organizacji ${ORG} osiągnęła dzienny limit wywołań LLM (3 wywołania) w dobie limitu od ${ISO_AT}.`,
    ],
  ])("%s", (_name, event, locale, text) => {
    expect(renderOperatorEvent(event, locale)).toBe(text);
  });
});

describe("the alert kind registry", () => {
  test("ALERT_LIFECYCLE has exactly the keys of OPERATOR_ALERT_KINDS", () => {
    expect(Object.keys(ALERT_LIFECYCLE).sort()).toEqual([...OPERATOR_ALERT_KINDS].sort());
  });

  test("each service level is an incident and each event is once", () => {
    expect(SLO_KINDS.map((kind) => ALERT_LIFECYCLE[kind])).toEqual(SLO_KINDS.map(() => "incident"));
    expect(OPERATOR_EVENT_KINDS.map((kind) => ALERT_LIFECYCLE[kind])).toEqual(OPERATOR_EVENT_KINDS.map(() => "once"));
  });

  test("the service levels and the events share no kind", () => {
    const shared = SLO_KINDS.filter((kind) => (OPERATOR_EVENT_KINDS as readonly string[]).includes(kind));
    expect(shared).toEqual([]);
  });
});
