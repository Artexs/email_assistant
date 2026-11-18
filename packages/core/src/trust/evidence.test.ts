import { describe, expect, test } from "bun:test";

import { autoEvidence, type AutoEvidenceInput, type EvidenceBlock, type GlobalEvidence } from "./evidence";

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
  test("a too-few global blocks as global_no_go: not eligible, not recommended", () => {
    const result = autoEvidence(input({ global: { ...go, decision: "too-few" } }));
    expect(result).toEqual({ eligible: false, recommended: false, blocks: ["global_no_go"] });
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

// The whole input space against the eligibility rule of `docs/capabilities/trust.md` and ADR 0028, written as a conjunction, not as a
// list of blocks: eligible = a non-provisional global `go`, a history that is not `fail`, and real labels that are not a
// `no-go` at 30 or more; recommended = eligible, no active trip and a moving category.
describe("autoEvidence over the whole input space", () => {
  const decisions = ["go", "no-go", "too-few", "none"] as const;
  const categories = ["urgent", "needs_reply", "info", "notification", "spam"] as const;
  const histories = [null, "pass", "fail", "inconclusive", "no_result"] as const;
  const labels = [
    { kept: 0, decision: "too-few" as const },
    { kept: 29, decision: "no-go" as const },
    { kept: 30, decision: "no-go" as const },
    { kept: 40, decision: "go" as const },
  ];
  const trips = [{ tripped: false, reason: null, at: null }, trip];
  let cases = 0;

  test.each(decisions)(
    "global %s: eligible, recommended and blocks follow the rule in every combination",
    (decision) => {
      for (const provisional of [false, true]) {
        for (const category of categories) {
          for (const history of histories) {
            for (const realLabels of labels) {
              for (const activeTrip of trips) {
                cases += 1;
                const result = autoEvidence({
                  category,
                  global: { ...go, decision, provisional },
                  history: history === null ? null : { outcome: history },
                  trip: activeTrip,
                  realLabels,
                });
                const label = JSON.stringify({
                  decision,
                  provisional,
                  category,
                  history,
                  realLabels,
                  tripped: activeTrip.tripped,
                });
                const labelsBlock = realLabels.kept >= 30 && realLabels.decision === "no-go";
                const eligible = decision === "go" && !provisional && history !== "fail" && !labelsBlock;
                const moving = category === "info" || category === "notification" || category === "spam";
                expect({ label, eligible: result.eligible }).toEqual({ label, eligible });
                expect({ label, recommended: result.recommended }).toEqual({
                  label,
                  recommended: eligible && !activeTrip.tripped && moving,
                });
                // Every reason that the rule names is in the list, and no other reason is.
                const expected: EvidenceBlock[] = [
                  ...(decision === "none" ? (["no_global"] as const) : []),
                  ...(decision === "no-go" || decision === "too-few" ? (["global_no_go"] as const) : []),
                  ...(provisional ? (["global_provisional"] as const) : []),
                  ...(history === "fail" ? (["history_fail"] as const) : []),
                  ...(activeTrip.tripped ? (["tripped"] as const) : []),
                  ...(labelsBlock ? (["real_labels_no_go"] as const) : []),
                ];
                expect({ label, blocks: result.blocks }).toEqual({ label, blocks: expected });
              }
            }
          }
        }
      }
    }
  );

  test("the loops ran every combination", () => {
    // 4 decisions x 2 provisional x 5 categories x 5 histories x 4 label cases x 2 trips
    expect(cases).toBe(4 * 2 * 5 * 5 * 4 * 2);
  });
});
