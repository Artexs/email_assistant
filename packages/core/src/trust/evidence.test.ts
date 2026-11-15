import { describe, expect, test } from "bun:test";

import { autoEvidence, type AutoEvidenceInput, type GlobalEvidence } from "./evidence";

const go: GlobalEvidence = {
  decision: "go",
  provisional: false,
  precision: 0.97,
  wilsonLower: 0.95,
  threshold: 0.9,
  cases: 200,
  file: "gate.json",
};

function input(change: Partial<AutoEvidenceInput> = {}): AutoEvidenceInput {
  return {
    category: "notification",
    global: go,
    history: { outcome: "pass" },
    trip: { tripped: false, reason: null, at: null },
    realLabels: { kept: 0, decision: "too-few" },
    ...change,
  };
}

const trip = { tripped: true, reason: "corrections" as const, at: new Date("2026-11-08T09:00:00Z") };

describe("autoEvidence", () => {
  test("go, final, history pass, no trip: eligible and recommended for notification", () => {
    expect(autoEvidence(input())).toEqual({ eligible: true, recommended: true, blocks: [] });
  });
  test("the same for urgent is eligible but not recommended", () => {
    expect(autoEvidence(input({ category: "urgent" }))).toEqual({ eligible: true, recommended: false, blocks: [] });
  });
  test("provisional global blocks", () => {
    const result = autoEvidence(input({ global: { ...go, provisional: true } }));
    expect(result.blocks).toEqual(["global_provisional"]);
    expect(result.eligible).toBe(false);
  });
  test("global none and global no-go block", () => {
    expect(autoEvidence(input({ global: { ...go, decision: "none" } })).blocks).toEqual(["no_global"]);
    expect(autoEvidence(input({ global: { ...go, decision: "no-go" } })).blocks).toEqual(["global_no_go"]);
  });
  test("a too-few global does not block by itself", () => {
    expect(autoEvidence(input({ global: { ...go, decision: "too-few" } })).blocks).toEqual([]);
  });
  test("history fail plus a trip: both blocks in union order, not eligible", () => {
    const result = autoEvidence(input({ history: { outcome: "fail" }, trip }));
    expect(result.blocks).toEqual(["history_fail", "tripped"]);
    expect(result.eligible).toBe(false);
    expect(result.recommended).toBe(false);
  });
  test.each([["inconclusive" as const], ["no_result" as const], [null]])("history %p does not block", (outcome) => {
    expect(autoEvidence(input({ history: outcome === null ? null : { outcome } })).blocks).toEqual([]);
  });
  test("real labels block from 30 kept with no-go only", () => {
    expect(autoEvidence(input({ realLabels: { kept: 30, decision: "no-go" } })).blocks).toEqual(["real_labels_no_go"]);
    expect(autoEvidence(input({ realLabels: { kept: 29, decision: "no-go" } })).blocks).toEqual([]);
    expect(autoEvidence(input({ realLabels: { kept: 40, decision: "go" } })).blocks).toEqual([]);
  });
  test("only an active trip: blocked, still eligible, not recommended", () => {
    expect(autoEvidence(input({ trip }))).toEqual({ eligible: true, recommended: false, blocks: ["tripped"] });
  });
  test("every block together, in union order", () => {
    const result = autoEvidence(
      input({
        global: { ...go, decision: "no-go", provisional: true },
        history: { outcome: "fail" },
        trip,
        realLabels: { kept: 50, decision: "no-go" },
      })
    );
    expect(result.blocks).toEqual([
      "global_no_go",
      "global_provisional",
      "history_fail",
      "tripped",
      "real_labels_no_go",
    ]);
  });
  test("spam and info are moving categories; needs_reply is not", () => {
    expect(autoEvidence(input({ category: "spam" })).recommended).toBe(true);
    expect(autoEvidence(input({ category: "info" })).recommended).toBe(true);
    expect(autoEvidence(input({ category: "needs_reply" })).recommended).toBe(false);
  });
});
