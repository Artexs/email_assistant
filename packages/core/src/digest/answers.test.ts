import { describe, expect, test } from "bun:test";

import { UNDO_TEXTS, pickAnswer, pickedText, rightAnswer } from "./answers";

describe("answers", () => {
  test("undo texts", () => {
    expect(UNDO_TEXTS).toEqual({
      started: "↩️ Undo started: the mail goes back within a minute.",
      already: "Undo was already requested for this mail.",
      nothing: "Nothing to undo.",
      too_old: "Too old to undo (7 days).",
      held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.",
    });
  });

  test("feedback answers", () => {
    expect(rightAnswer(true, "info")).toBe("✅ Saved: Info is right.");
    expect(rightAnswer(false, "info")).toBe("Already saved.");
    expect(pickedText("needs_reply", "info")).toBe("✏️ Saved: Reply (AI said Info).");
    expect(pickAnswer(true)).toBe("Saved.");
    expect(pickAnswer(false)).toBe("Already saved.");
  });
});
