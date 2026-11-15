import { describe, expect, test } from "bun:test";

import { HINT_MAX, sentHardCaseRule, sentHardCaseRules, sentHardCaseTags } from "./sent-hard-cases";

describe("sent hard-case registry", () => {
  test("T3 the 13 tags of the discovery notes each have a label rule and a brief hint", () => {
    expect([...sentHardCaseTags]).toEqual([
      "thanks_only",
      "fyi_team",
      "question_in_forward",
      "conditional_promise",
      "reported_speech",
      "let_me_know_if",
      "reply_to_ooo",
      "other_thread_subject",
      "injection_quote",
      "time_word_due",
      "past_date",
      "far_date",
      "many_recipients",
    ]);
    for (const rule of sentHardCaseRules) {
      expect(rule.labels).toBeDefined();
      expect(rule.hint.length).toBeGreaterThan(10);
      expect(rule.hint.length).toBeLessThanOrEqual(HINT_MAX);
      expect(rule.short).toMatch(/^[a-z]{2,4}$/);
    }
    expect(new Set(sentHardCaseRules.map((r) => r.short)).size).toBe(sentHardCaseRules.length);
  });

  test("T3 the tags that decide the labels", () => {
    for (const tag of ["thanks_only", "fyi_team", "reported_speech"]) {
      expect(sentHardCaseRule(tag).labels.expectsReply).toBe(false);
    }
    expect(sentHardCaseRule("conditional_promise").labels.promise).toBe("none");
    expect(sentHardCaseRule("past_date").labels.due).toBe("none");
    expect(sentHardCaseRule("far_date").labels.due).toBe("none");
    expect(sentHardCaseRule("time_word_due").labels.due).toBe("word");
    expect(sentHardCaseRule("many_recipients")).toMatchObject({
      manyRecipients: true,
      labels: { expectsReply: false, promise: "none" },
    });
  });

  test("a hint names no label word", () => {
    for (const rule of sentHardCaseRules) expect(rule.hint).not.toMatch(/expects_reply|expectsReply|promiseDue/);
  });

  test("an unknown tag is an error", () => {
    expect(() => sentHardCaseRule("nope")).toThrow();
  });
});
