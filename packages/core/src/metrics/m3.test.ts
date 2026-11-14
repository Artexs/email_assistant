import { describe, expect, test } from "bun:test";

import { hiddenMoveRow, mistakeRow, rejectRow } from "./fixtures";
import { seriousMistakes } from "./m3";
import { weekRange } from "./week";

const range = weekRange("2026-11-16", "Europe/Warsaw");
const inWeek = new Date("2026-11-18T10:00:00Z");
const weekBefore = new Date("2026-11-11T10:00:00Z");
const weekAfter = new Date("2026-11-25T10:00:00Z");
const none = { moves: [], rejects: [], mistakes: [] };

describe("seriousMistakes: hidden important mail", () => {
  test("counts the moves that hid important mail, once per mail", () => {
    const repeated = hiddenMoveRow({ folder: "ai_info", truth: "needs_reply", appliedAt: inWeek });
    const moves = [
      repeated,
      { ...repeated, appliedAt: new Date("2026-11-19T10:00:00Z") },
      hiddenMoveRow({ folder: "ai_spam", vip: true, appliedAt: inWeek }),
      hiddenMoveRow({ folder: "ai_spam", whitelisted: true, appliedAt: inWeek }),
      hiddenMoveRow({ folder: "ai_notifications", truth: "notification", appliedAt: inWeek }),
      hiddenMoveRow({ folder: "inbox", truth: "urgent", appliedAt: inWeek }),
      hiddenMoveRow({ folder: "ai_info", truth: "urgent", appliedAt: weekBefore }),
    ];
    expect(seriousMistakes({ ...none, moves }, range).hiddenImportant).toBe(3);
  });

  test("a VIP mail in a folder other than spam is no mistake without a truth", () => {
    const moves = [hiddenMoveRow({ folder: "ai_info", vip: true, appliedAt: inWeek })];
    expect(seriousMistakes({ ...none, moves }, range).hiddenImportant).toBe(0);
  });
});

describe("seriousMistakes: rejects", () => {
  test("counts the reasons of the week and shows the two that do not count", () => {
    const rejects = [
      rejectRow({ rejectedAt: inWeek, reason: "wrong_person" }),
      rejectRow({ rejectedAt: inWeek, reason: "wrong_content" }),
      rejectRow({ rejectedAt: inWeek, reason: "wrong_content" }),
      rejectRow({ rejectedAt: inWeek, reason: "not_needed" }),
      rejectRow({ rejectedAt: inWeek, reason: null }),
      rejectRow({ rejectedAt: weekAfter, reason: "wrong_person" }),
    ];
    expect(seriousMistakes({ ...none, rejects }, range)).toMatchObject({
      wrongPerson: 1,
      wrongContent: 2,
      notNeeded: 1,
      noReason: 1,
      total: 3,
    });
  });
});

describe("seriousMistakes: sent mistakes", () => {
  test("counts the mistakes by the week of the send, one per action", () => {
    const first = mistakeRow({ sentAt: inWeek });
    const mistakes = [first, { ...first }, mistakeRow({ sentAt: inWeek }), mistakeRow({ sentAt: weekAfter })];
    expect(seriousMistakes({ ...none, mistakes }, range).sentMistake).toBe(2);
  });

  test("the total adds the four counted kinds and leaves out the shown ones", () => {
    const result = seriousMistakes(
      {
        moves: [hiddenMoveRow({ folder: "ai_info", truth: "needs_reply", appliedAt: inWeek })],
        rejects: [
          rejectRow({ rejectedAt: inWeek, reason: "wrong_person" }),
          rejectRow({ rejectedAt: inWeek, reason: "wrong_content" }),
          rejectRow({ rejectedAt: inWeek, reason: "wrong_content" }),
          rejectRow({ rejectedAt: inWeek, reason: "not_needed" }),
        ],
        mistakes: [mistakeRow({ sentAt: inWeek }), mistakeRow({ sentAt: inWeek })],
      },
      range
    );
    expect(result.total).toBe(1 + 1 + 2 + 2);
  });
});
