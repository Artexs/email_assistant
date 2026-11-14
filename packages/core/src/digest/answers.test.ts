import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { pickAnswer, pickedText, rightAnswer } from "./answers";

const en = textTables.en;

describe("answers", () => {
  test("undo texts", () => {
    expect(en.answers.undo).toEqual({
      started: "↩️ Undo started: the mail goes back within a minute.",
      already: "Undo was already requested for this mail.",
      nothing: "Nothing to undo.",
      too_old: "Too old to undo (7 days).",
      held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.",
    });
  });

  test("feedback answers", () => {
    expect(rightAnswer(true, "info", en)).toBe("✅ Saved: Info is right.");
    expect(rightAnswer(false, "info", en)).toBe("Already saved.");
    expect(pickedText("needs_reply", "info", true, en)).toBe("✏️ Saved: Reply (AI said Info).");
    expect(pickedText("needs_reply", "info", false, en)).toBe("✏️ Already saved: Reply (AI said Info).");
    expect(pickAnswer(true, en)).toBe("Saved.");
    expect(pickAnswer(false, en)).toBe("Already saved.");
  });

  test("Polish answers", () => {
    expect(rightAnswer(true, "spam", textTables.pl)).toContain("Spam");
    expect(pickedText("info", "spam", true, textTables.pl).startsWith("✏️")).toBe(true);
  });
});
