import { describe, expect, test } from "bun:test";
import {
  categories,
  categoryLabels,
  categoryTag,
  labelCategories,
  pickAnswer,
  pickedText,
  rightAnswer,
  UNDO_TEXTS,
  type ActivityItem,
} from "@ea/core/web";

import {
  categoryName,
  categoryTagText,
  confidenceText,
  delegationText,
  feedbackStateText,
  feedbackToast,
  senderText,
  subjectText,
  undoToast,
} from "./activity-text";

const kinds = ["started", "already", "nothing", "too_old", "held"] as const;

function feedback(patch: Partial<NonNullable<ActivityItem["feedback"]>>): NonNullable<ActivityItem["feedback"]> {
  return { verdict: "right", trueCategory: null, source: "web", at: "2026-11-11T10:00:00.000Z", ...patch };
}

describe("words tied to the Telegram source (U6)", () => {
  test("undo toasts equal UNDO_TEXTS", () => {
    for (const kind of kinds) expect(undoToast(kind)).toBe(UNDO_TEXTS[kind]);
  });

  test("category names and tags equal the core labels", () => {
    for (const c of categories) {
      expect(categoryName(c)).toBe(categoryLabels[c].name);
      expect(categoryTagText(c)).toBe(categoryTag(c));
    }
  });

  test("right and pick toasts equal the Telegram answers", () => {
    for (const c of labelCategories) {
      expect(feedbackToast("right", { saved: true, verdict: "right", aiCategory: c }, c)).toBe(rightAnswer(true, c));
      expect(feedbackToast("right", { saved: false, verdict: "right", aiCategory: c }, c)).toBe(rightAnswer(false, c));
    }
    for (const picked of labelCategories) {
      for (const ai of labelCategories) {
        expect(feedbackToast("pick", { saved: true, verdict: "wrong", aiCategory: ai }, picked)).toBe(
          pickedText(picked, ai)
        );
      }
    }
    // Not saved: the same words as the Telegram pick answer.
    expect(feedbackToast("pick", { saved: false, verdict: "wrong", aiCategory: "info" }, "urgent")).toBe(
      pickAnswer(false)
    );
  });
});

describe("row texts", () => {
  test("fallbacks and confidence", () => {
    expect(subjectText(null)).toBe("(no subject)");
    expect(subjectText("Hi")).toBe("Hi");
    expect(senderText(null)).toBe("(unknown sender)");
    expect(senderText("a@x.test")).toBe("a@x.test");
    expect(confidenceText(0.934)).toBe("93 %");
  });

  test("feedback state", () => {
    expect(feedbackStateText(null)).toBe("Not rated yet");
    expect(feedbackStateText(feedback({ verdict: "right", trueCategory: "info" }))).toBe("You said: right");
    expect(feedbackStateText(feedback({ verdict: "wrong", trueCategory: "info" }))).toBe("You said: Info");
    expect(feedbackStateText(feedback({ verdict: "wrong", source: "undo" }))).toBe("You said: wrong (Undo)");
    expect(feedbackStateText(feedback({ verdict: "wrong", source: "telegram" }))).toBe("You said: wrong (Undo)");
  });

  test("delegation text", () => {
    expect(delegationText({ delegateName: "Ola", status: "drafted", dueAt: null })).toBe("Ola · Drafted");
    expect(delegationText({ delegateName: null, status: "drafted", dueAt: null })).toBe("A delegate · Drafted");
  });
});
