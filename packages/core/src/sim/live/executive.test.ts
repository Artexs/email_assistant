import { describe, expect, test } from "bun:test";

import { type Callback, encodeCallback, parseCallback } from "../../digest/callback";
import { localDateTime } from "../../digest/local-time";

import {
  cardsOf,
  executiveDecision,
  executiveTapAt,
  type ExecCard,
  type ExecCardKind,
  type ExecTruth,
} from "./executive";

const ID = "11111111-1111-4111-8111-111111111111";
const MAIL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAIL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAIL_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MAGDA = "magdalena.czerniak@kordelan.test";
const DOROTA = "dorota.wilczynska@kordelan.test";

const fresh = { sentAgain: false };

function approval(draft: ExecCard["draft"]): ExecCard {
  return { kind: "approval", messageId: 7, buttons: [`ap:${ID}`, `ar:${ID}`], actionId: ID, draft };
}

function truth(partial: Partial<NonNullable<ExecTruth>> = {}): ExecTruth {
  return { category: "delegation", expectedDraft: "delegation", expectedDelegateAddress: MAGDA, ...partial };
}

describe("executiveDecision approvals", () => {
  test("1: a delegation draft to the expected delegate (any case) is approved", () => {
    const card = approval({ kind: "delegation", recipient: MAGDA });
    expect(executiveDecision(card, truth({ expectedDelegateAddress: MAGDA.toUpperCase() }), fresh)).toEqual({
      press: `ap:${ID}`,
    });
  });

  test("1b: the recipient case does not matter either", () => {
    const card = approval({ kind: "delegation", recipient: MAGDA.toUpperCase() });
    expect(executiveDecision(card, truth(), fresh)).toEqual({ press: `ap:${ID}` });
  });

  test("2: a delegation draft to another delegate is rejected as wrong person", () => {
    const card = approval({ kind: "delegation", recipient: MAGDA });
    expect(executiveDecision(card, truth({ expectedDelegateAddress: DOROTA }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_wrong_person",
    });
  });

  test("2b: an expected category of delegation with no expected address is wrong person", () => {
    const card = approval({ kind: "delegation", recipient: MAGDA });
    expect(executiveDecision(card, truth({ expectedDelegateAddress: undefined }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_wrong_person",
    });
  });

  test("3: a clarification draft is approved when one is expected, else rejected as not needed", () => {
    const card = approval({ kind: "clarification", recipient: "anna@kordelan.test" });
    expect(executiveDecision(card, truth({ category: "needs_reply", expectedDraft: "clarification" }), fresh)).toEqual({
      press: `ap:${ID}`,
    });
    expect(executiveDecision(card, truth({ category: "needs_reply", expectedDraft: "none" }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_not_needed",
    });
  });

  test("3b: a clarification draft with no expected draft in the truth is rejected as not needed", () => {
    const card = approval({ kind: "clarification", recipient: "anna@kordelan.test" });
    expect(executiveDecision(card, truth({ category: "info", expectedDraft: undefined }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_not_needed",
    });
  });

  test("12: a delegation draft for a mail that is not a delegation is not needed, never wrong person", () => {
    const card = approval({ kind: "delegation", recipient: MAGDA });
    const info = truth({ category: "info", expectedDraft: "none", expectedDelegateAddress: undefined });
    expect(executiveDecision(card, info, fresh)).toEqual({ press: `ar:${ID}`, then: "reason_not_needed" });
    // Even when the truth names an address that equals the recipient, the category decides first.
    expect(executiveDecision(card, truth({ category: "info" }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_not_needed",
    });
  });

  test("4b: any other draft is rejected as not needed", () => {
    const card = approval({ kind: "other", recipient: "x@kordelan.test" });
    expect(executiveDecision(card, truth({ category: "needs_reply" }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_not_needed",
    });
  });

  test("an approval card with no read draft gets no press and counts no_rule", () => {
    const card = approval(undefined);
    expect(executiveDecision(card, truth(), fresh)).toEqual({ press: null, count: "no_rule" });
  });

  test("a press with no reason is only the button, without a reason key", () => {
    const card = approval({ kind: "delegation", recipient: MAGDA });
    expect(executiveDecision(card, truth(), fresh)).toStrictEqual({ press: `ap:${ID}` });
  });

  test("a draft of another kind is rejected as not needed even when a clarification is expected", () => {
    const card = approval({ kind: "other", recipient: MAGDA });
    expect(executiveDecision(card, truth({ category: "needs_reply", expectedDraft: "clarification" }), fresh)).toEqual({
      press: `ar:${ID}`,
      then: "reason_not_needed",
    });
  });

  test("a card that lacks the button of its rule gets no press", () => {
    const card: ExecCard = { ...approval({ kind: "delegation", recipient: MAGDA }), buttons: [`ar:${ID}`] };
    expect(executiveDecision(card, truth(), fresh)).toEqual({ press: null, count: "no_rule" });
  });
});

describe("executiveDecision other cards", () => {
  const reasonCard: ExecCard = {
    kind: "reject_reason",
    messageId: 7,
    buttons: [`rw:p:${ID}`, `rw:c:${ID}`, `rw:n:${ID}`],
    actionId: ID,
  };

  test("4: the planned reason decides the reason button; none planned is no_rule", () => {
    expect(executiveDecision(reasonCard, truth(), { sentAgain: false, pendingReason: "p" })).toEqual({
      press: `rw:p:${ID}`,
    });
    expect(executiveDecision(reasonCard, truth(), { sentAgain: false, pendingReason: "n" })).toEqual({
      press: `rw:n:${ID}`,
    });
    expect(executiveDecision(reasonCard, truth(), fresh)).toEqual({ press: null, count: "no_rule" });
  });

  test("5: a reminder set is approved", () => {
    const card: ExecCard = { kind: "reminder_set", messageId: 8, buttons: [`as:${ID}`, `rs:${ID}`], setId: ID };
    expect(executiveDecision(card, truth({ category: "needs_reply" }), fresh)).toEqual({ press: `as:${ID}` });
  });

  test("6: a failed send is sent again once", () => {
    const card: ExecCard = { kind: "send_failed", messageId: 9, buttons: [`ag:${ID}`, `gw:${ID}`], actionId: ID };
    expect(executiveDecision(card, truth(), fresh)).toEqual({ press: `ag:${ID}` });
    expect(executiveDecision(card, truth(), { sentAgain: true })).toEqual({ press: null });
  });

  describe("7: Undo", () => {
    const feedback = (moved: boolean | undefined): ExecCard => ({
      kind: "feedback",
      messageId: 10,
      buttons: [`fr:u:${MAIL_A}`, `fe:${MAIL_A}`, `fu:${MAIL_A}`],
      emailId: MAIL_A,
      moved,
    });

    test("a moved urgent, needs_reply or delegation mail is undone", () => {
      for (const category of ["urgent", "needs_reply", "delegation"] as const) {
        expect(executiveDecision(feedback(true), truth({ category }), fresh)).toEqual({ press: `fu:${MAIL_A}` });
      }
    });

    test("spam, info and notification stay moved", () => {
      for (const category of ["spam", "info", "notification"] as const) {
        expect(executiveDecision(feedback(true), truth({ category }), fresh)).toEqual({ press: null });
      }
    });

    test("a card that reports no move is left alone", () => {
      expect(executiveDecision(feedback(false), truth({ category: "urgent" }), fresh)).toEqual({ press: null });
      expect(executiveDecision(feedback(undefined), truth({ category: "urgent" }), fresh)).toEqual({ press: null });
    });

    test("a feedback card with no Undo button is left alone", () => {
      const card: ExecCard = { ...feedback(true), buttons: [`fr:u:${MAIL_A}`, `fe:${MAIL_A}`] };
      expect(executiveDecision(card, truth({ category: "urgent" }), fresh)).toEqual({ press: null });
    });
  });

  test("8: a card whose mail is not a lab mail of this run counts unmapped, whatever its kind", () => {
    const kinds: ExecCardKind[] = ["approval", "reminder_set", "send_failed", "reject_reason", "feedback", "other"];
    for (const kind of kinds) {
      const card: ExecCard = {
        kind,
        messageId: 1,
        buttons: [`ap:${ID}`, `as:${ID}`, `ag:${ID}`, `rw:p:${ID}`, `fu:${ID}`],
        moved: true,
        draft: { kind: "delegation", recipient: MAGDA },
      };
      expect(executiveDecision(card, null, { sentAgain: false, pendingReason: "p" })).toEqual({
        press: null,
        count: "unmapped",
      });
    }
  });

  test("9: a card with only fr and fe buttons gets no press", () => {
    const card: ExecCard = {
      kind: "feedback",
      messageId: 10,
      buttons: [`fr:u:${MAIL_A}`, `fe:${MAIL_A}`],
      emailId: MAIL_A,
      moved: true,
    };
    expect(executiveDecision(card, truth({ category: "urgent" }), fresh)).toEqual({ press: null });
  });

  test("a card of kind other gets no press and counts no_rule", () => {
    const card: ExecCard = { kind: "other", messageId: 11, buttons: [`ay:${ID}`, `an:${ID}`] };
    expect(executiveDecision(card, truth(), fresh)).toEqual({ press: null, count: "no_rule" });
  });
});

// The executive approves, rejects and undoes. It never relabels, edits, or answers a check.
describe("the executive never presses a forbidden button", () => {
  test("over every card kind, truth and memory the press is only ap, ar, rw, as, ag or fu", () => {
    const allButtons = [
      `ap:${ID}`,
      `ar:${ID}`,
      `as:${ID}`,
      `rs:${ID}`,
      `ag:${ID}`,
      `gw:${ID}`,
      `dd:${ID}`,
      `mk:${ID}`,
      `ay:${ID}`,
      `an:${ID}`,
      `fr:u:${ID}`,
      `fc:s:${ID}`,
      `fe:${ID}`,
      `fx:${ID}`,
      `fu:${ID}`,
      `vr:u:${ID}`,
      `vc:d:${ID}`,
      `ve:${ID}`,
      `vx:${ID}`,
      `rw:p:${ID}`,
      `rw:c:${ID}`,
      `rw:n:${ID}`,
    ];
    const kinds: ExecCardKind[] = ["approval", "reminder_set", "send_failed", "reject_reason", "feedback", "other"];
    const categories = ["urgent", "needs_reply", "info", "notification", "spam", "delegation"] as const;
    const drafts: ExecCard["draft"][] = [
      undefined,
      { kind: "delegation", recipient: MAGDA },
      { kind: "delegation", recipient: DOROTA },
      { kind: "clarification", recipient: MAGDA },
      { kind: "other", recipient: MAGDA },
    ];
    const allowed = new Set(["ap", "ar", "rw", "as", "ag", "fu"]);
    let pressed = 0;
    for (const kind of kinds) {
      for (const draft of drafts) {
        for (const category of categories) {
          for (const expectedDraft of ["delegation", "clarification", "none", undefined] as const) {
            for (const pendingReason of ["p", "n", undefined] as const) {
              const card: ExecCard = { kind, messageId: 1, buttons: allButtons, draft, moved: true };
              const action = executiveDecision(
                card,
                { category, expectedDraft, expectedDelegateAddress: MAGDA },
                { sentAgain: false, pendingReason }
              );
              if (action.press === null) continue;
              pressed += 1;
              expect(allowed.has(action.press.slice(0, action.press.indexOf(":")))).toBe(true);
              expect(parseCallback(action.press)).not.toBeNull();
            }
          }
        }
      }
    }
    expect(pressed).toBeGreaterThan(0);
  });
});

describe("executiveTapAt", () => {
  // Warsaw wall clock of the result, in minutes from midnight, with its date.
  function warsaw(iso: string): { date: string; minutes: number } {
    const local = localDateTime(new Date(iso), "Europe/Warsaw");
    return { date: local.date, minutes: Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3, 5)) };
  }
  const at = (hh: number, mm: number): number => hh * 60 + mm;

  // 2026-11-23 is a Monday; Warsaw is UTC+1 in November.
  const cases: { name: string; cardAt: string; date: string; from: number; to: number }[] = [
    { name: "Mon 07:00", cardAt: "2026-11-23T06:00:00Z", date: "2026-11-23", from: at(8, 5), to: at(9, 30) },
    { name: "Mon 12:00", cardAt: "2026-11-23T11:00:00Z", date: "2026-11-23", from: at(12, 5), to: at(13, 30) },
    { name: "Fri 17:50", cardAt: "2026-11-27T16:50:00Z", date: "2026-11-27", from: at(17, 55), to: at(19, 20) },
    { name: "Fri 18:30", cardAt: "2026-11-27T17:30:00Z", date: "2026-11-28", from: at(10, 5), to: at(11, 30) },
    { name: "Sun 23:00", cardAt: "2026-11-29T22:00:00Z", date: "2026-11-30", from: at(8, 5), to: at(9, 30) },
    {
      name: "Sat 11:00 (window end)",
      cardAt: "2026-11-28T10:00:00Z",
      date: "2026-11-29",
      from: at(10, 5),
      to: at(11, 30),
    },
    { name: "Sat 07:00", cardAt: "2026-11-28T06:00:00Z", date: "2026-11-28", from: at(10, 5), to: at(11, 30) },
    { name: "Sun 10:30", cardAt: "2026-11-29T09:30:00Z", date: "2026-11-29", from: at(10, 35), to: at(12, 0) },
    { name: "Sun 11:30", cardAt: "2026-11-29T10:30:00Z", date: "2026-11-30", from: at(8, 5), to: at(9, 30) },
  ];

  for (const { name, cardAt, date, from, to } of cases) {
    test(`10: ${name} lands in its window`, () => {
      for (let seed = 0; seed < 200; seed += 1) {
        const tap = warsaw(executiveTapAt(cardAt, seed));
        expect(tap.date).toBe(date);
        expect(tap.minutes).toBeGreaterThanOrEqual(from);
        expect(tap.minutes).toBeLessThanOrEqual(to);
      }
    });
  }

  test("10: the same seed gives the same time; seeds spread over the 5 to 90 minute range", () => {
    const cardAt = "2026-11-23T11:00:00Z";
    expect(executiveTapAt(cardAt, 42)).toBe(executiveTapAt(cardAt, 42));
    const delays = new Set<number>();
    for (let seed = 0; seed < 100; seed += 1) {
      const delay = (new Date(executiveTapAt(cardAt, seed)).getTime() - new Date(cardAt).getTime()) / 60_000;
      expect(delay).toBeGreaterThanOrEqual(5);
      expect(delay).toBeLessThanOrEqual(90);
      delays.add(Math.round(delay));
    }
    expect(delays.size).toBeGreaterThan(30);
  });

  test("a time in the window starts from the card time itself, in UTC ISO form", () => {
    const tap = executiveTapAt("2026-11-23T11:00:00Z", 1);
    expect(tap).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("the window start follows the Warsaw clock in summer time", () => {
    // 2027-06-14 is a Monday, UTC+2: 05:00 UTC is 07:00 Warsaw, so the start is 08:00 Warsaw = 06:00 UTC.
    const tap = new Date(executiveTapAt("2027-06-14T05:00:00Z", 3)).getTime();
    const start = new Date("2027-06-14T06:00:00Z").getTime();
    expect(tap - start).toBeGreaterThanOrEqual(5 * 60_000);
    expect(tap - start).toBeLessThanOrEqual(90 * 60_000);
  });

  test("the longest gap between two windows is 23 h", () => {
    // Saturday 11:00 -> Sunday 10:00 Warsaw is the longest wait; the tap is at most 90 min later.
    const cardAt = new Date("2026-11-28T10:00:00Z").getTime();
    for (let seed = 0; seed < 200; seed += 1) {
      const wait = new Date(executiveTapAt("2026-11-28T10:00:00Z", seed)).getTime() - cardAt;
      expect(wait).toBeLessThanOrEqual(24.5 * 3_600_000);
    }
  });

  test("a text that is not a time throws", () => {
    expect(() => executiveTapAt("not a date", 1)).toThrow("executiveTapAt needs an ISO instant");
  });

  test("a card at the first minute of the hours starts from that minute", () => {
    // 2026-11-23 08:00 Warsaw is 07:00 UTC: the tap is 5 to 90 minutes after the card, on the same day.
    const delay = new Date(executiveTapAt("2026-11-23T07:00:00Z", 1)).getTime() - Date.parse("2026-11-23T07:00:00Z");
    expect(delay).toBeGreaterThanOrEqual(5 * 60_000);
    expect(delay).toBeLessThanOrEqual(90 * 60_000);
  });
});

describe("cardsOf", () => {
  test("11: the buttons of one action are one approval card", () => {
    expect(cardsOf(5, [`ap:${ID}`, `ar:${ID}`])).toEqual([
      { kind: "approval", messageId: 5, buttons: [`ap:${ID}`, `ar:${ID}`], actionId: ID },
    ]);
  });

  test("11: a reminder set card", () => {
    expect(cardsOf(5, [`as:${ID}`, `rs:${ID}`])).toEqual([
      { kind: "reminder_set", messageId: 5, buttons: [`as:${ID}`, `rs:${ID}`], setId: ID },
    ]);
  });

  test("11: the reason buttons are one reject_reason card on the same message id", () => {
    const buttons = [`rw:p:${ID}`, `rw:c:${ID}`, `rw:n:${ID}`];
    expect(cardsOf(5, buttons)).toEqual([{ kind: "reject_reason", messageId: 5, buttons, actionId: ID }]);
  });

  test("a failed send card has send again and went out", () => {
    expect(cardsOf(5, [`ag:${ID}`, `gw:${ID}`])).toEqual([
      { kind: "send_failed", messageId: 5, buttons: [`ag:${ID}`, `gw:${ID}`], actionId: ID },
    ]);
  });

  test("11: a digest with buttons for three mails gives three feedback cards of three buttons", () => {
    const buttons = [MAIL_A, MAIL_B, MAIL_C].flatMap((id) => [`fr:u:${id}`, `fe:${id}`, `fu:${id}`]);
    const cards = cardsOf(6, buttons);
    expect(cards.map((card) => card.kind)).toEqual(["feedback", "feedback", "feedback"]);
    expect(cards.map((card) => card.emailId)).toEqual([MAIL_A, MAIL_B, MAIL_C]);
    for (const card of cards) {
      expect(card.messageId).toBe(6);
      expect(card.buttons).toHaveLength(3);
      expect(card.buttons.every((data) => data.endsWith(card.emailId as string))).toBe(true);
    }
  });

  test("buttons that interleave across mails still group by id", () => {
    const cards = cardsOf(6, [`fu:${MAIL_A}`, `fu:${MAIL_B}`, `fe:${MAIL_A}`, `fe:${MAIL_B}`]);
    expect(cards.map((card) => card.buttons)).toEqual([
      [`fu:${MAIL_A}`, `fe:${MAIL_A}`],
      [`fu:${MAIL_B}`, `fe:${MAIL_B}`],
    ]);
  });

  test("a digest card feeds the Undo rule through its own buttons only", () => {
    const cards = cardsOf(6, [`fu:${MAIL_A}`, `fe:${MAIL_B}`]);
    const withMoved = cards.map((card): ExecCard => ({ ...card, moved: true }));
    const urgent = { category: "urgent" } as const;
    expect(withMoved.map((card) => executiveDecision(card, urgent, fresh))).toEqual([
      { press: `fu:${MAIL_A}` },
      { press: null },
    ]);
  });

  test("review, check and unreadable buttons never become an approval card", () => {
    const cards = cardsOf(7, [`ay:${ID}`, `an:${ID}`, `vr:u:${MAIL_A}`, "garbage", "ap:not-an-id"]);
    expect(cards.map((card) => card.kind)).toEqual(["other", "other"]);
    expect(cards.flatMap((card) => card.buttons)).not.toContain("garbage");
  });

  test("an empty message gives no card", () => {
    expect(cardsOf(1, [])).toEqual([]);
  });
});

describe("cardsOf by the kind of the button", () => {
  type CardIdField = "actionId" | "setId" | "emailId" | undefined;
  const row = (
    callback: Callback,
    kind: ExecCardKind,
    idField: CardIdField
  ): [string, Callback, ExecCardKind, CardIdField] => [`${callback.kind} is ${kind}`, callback, kind, idField];

  test.each([
    row({ kind: "approve", actionId: ID }, "approval", "actionId"),
    row({ kind: "reject", actionId: ID }, "approval", "actionId"),
    row({ kind: "approve_set", setId: ID }, "reminder_set", "setId"),
    row({ kind: "reject_set", setId: ID }, "reminder_set", "setId"),
    row({ kind: "send_again", actionId: ID }, "send_failed", "actionId"),
    row({ kind: "went_out", actionId: ID }, "send_failed", "actionId"),
    row({ kind: "right", category: "urgent", emailId: ID }, "feedback", "emailId"),
    row({ kind: "pick", category: "info", emailId: ID }, "feedback", "emailId"),
    row({ kind: "cancel", emailId: ID }, "feedback", "emailId"),
    row({ kind: "mistake", actionId: ID }, "other", undefined),
    row({ kind: "delegation_done", delegationId: ID }, "other", undefined),
    row({ kind: "review_right", category: "urgent", emailId: ID }, "other", undefined),
    row({ kind: "answered_yes", emailId: ID }, "other", undefined),
    row({ kind: "delegate_open", emailId: ID }, "other", undefined),
    row({ kind: "reply_draft", emailId: ID }, "other", undefined),
  ])("a single button: %s", (_name, callback, kind, idField) => {
    const data = encodeCallback(callback);
    const expected: ExecCard = { kind, messageId: 4, buttons: [data] };
    if (idField !== undefined) expected[idField] = ID;
    expect(cardsOf(4, [data])).toEqual([expected]);
  });

  test("a button that names no action, set, mail or delegation is part of no card", () => {
    const loop = encodeCallback({ kind: "loop_done", loopId: ID });
    const skip = encodeCallback({ kind: "reply_skip", sendId: ID });
    const review = encodeCallback({ kind: "reply_review" });
    expect(cardsOf(4, [loop, skip, review, `ap:${ID}`])).toEqual([
      { kind: "approval", messageId: 4, buttons: [`ap:${ID}`], actionId: ID },
    ]);
  });

  test("buttons of one id with two kinds make one card of the kind that comes first in the card order", () => {
    const cards = cardsOf(4, [`ap:${ID}`, `rw:p:${ID}`, `mk:${ID}`]);
    expect(cards).toEqual([
      { kind: "reject_reason", messageId: 4, buttons: [`ap:${ID}`, `rw:p:${ID}`, `mk:${ID}`], actionId: ID },
    ]);
    expect(cardsOf(4, [`rw:p:${ID}`, `ap:${ID}`])).toEqual([
      { kind: "reject_reason", messageId: 4, buttons: [`rw:p:${ID}`, `ap:${ID}`], actionId: ID },
    ]);
    expect(cardsOf(4, [`mk:${ID}`, `ag:${ID}`, `ap:${ID}`])).toEqual([
      { kind: "approval", messageId: 4, buttons: [`mk:${ID}`, `ag:${ID}`, `ap:${ID}`], actionId: ID },
    ]);
  });
});
