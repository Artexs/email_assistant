import { describe, expect, test } from "bun:test";

import { categories, type Category } from "./categories";
import type { PlannedAction } from "./planners";
import { actionStatusFor, decidePolicy, type PolicyDecision, type PolicyInput } from "./policy";
import type { ToolSwitches } from "./settings";

const allOff: ToolSwitches = { move: false, mark_read: false, flag: false, create_draft: false, move_unsure: false };
const allOn: ToolSwitches = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: true };

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mode: "assist",
    toolSwitches: allOn,
    category: "info",
    categoryAuto: true,
    vip: false,
    movesSupported: true,
    ...overrides,
  };
}

const move: PlannedAction = { type: "move", folder: "ai_info" };
const inboxMove: PlannedAction = { type: "move", folder: "inbox" };
const manualMove: PlannedAction = { type: "move", folder: "ai_manual" };
const markRead: PlannedAction = { type: "mark_read" };
const flag: PlannedAction = { type: "flag" };
const saveSummary: PlannedAction = { type: "save_summary", summary: "Short summary." };
const createDraft: PlannedAction = {
  type: "create_draft",
  draft: { kind: "clarification", to: ["a@b.test"], question: "Who?", language: "en" },
};
const send: PlannedAction = {
  type: "send",
  send: { kind: "clarification", to: ["a@b.test"] },
  dependsOn: "create_draft",
};

const allActions: PlannedAction[] = [
  { type: "move", folder: "ai_info" },
  { type: "move", folder: "ai_notifications" },
  { type: "move", folder: "ai_spam" },
  { type: "move", folder: "ai_manual" },
  markRead,
  flag,
  saveSummary,
];

function allSwitchCombinations(): ToolSwitches[] {
  const keys = Object.keys(allOff) as (keyof ToolSwitches)[];
  const combinations: ToolSwitches[] = [];
  for (let bits = 0; bits < 2 ** keys.length; bits++) {
    const switches = { ...allOff };
    keys.forEach((key, index) => {
      switches[key] = (bits & (1 << index)) !== 0;
    });
    combinations.push(switches);
  }
  return combinations;
}

describe("decidePolicy: the §4.3 table", () => {
  test.each<[string, PlannedAction, Partial<PolicyInput>, PolicyDecision]>([
    // Save summary: apply in every column.
    ["save_summary shadow", saveSummary, { mode: "shadow" }, "apply"],
    ["save_summary assist", saveSummary, {}, "apply"],
    ["save_summary assist, all off", saveSummary, { toolSwitches: allOff, categoryAuto: false }, "apply"],
    ["save_summary vip", saveSummary, { vip: true }, "apply"],
    ["save_summary vip shadow", saveSummary, { vip: true, mode: "shadow" }, "apply"],

    // Move.
    ["move shadow", move, { mode: "shadow" }, "log_only"],
    ["move assist, all on", move, {}, "apply"],
    ["move assist, switch off", move, { toolSwitches: { ...allOn, move: false } }, "log_only"],
    ["move assist, category not auto", move, { categoryAuto: false }, "log_only"],
    ["move assist, no move support", move, { movesSupported: false }, "log_only"],
    ["move assist, only move_unsure on", move, { toolSwitches: { ...allOff, move_unsure: true } }, "log_only"],
    ["inbox move assist, all on", inboxMove, { category: "urgent" }, "apply"],
    ["inbox move, category not auto", inboxMove, { category: "urgent", categoryAuto: false }, "log_only"],
    ["inbox move vip", inboxMove, { category: "urgent", vip: true }, "log_only"],
    ["inbox move shadow", inboxMove, { category: "urgent", mode: "shadow" }, "log_only"],
    ["inbox move, no move support", inboxMove, { category: "urgent", movesSupported: false }, "log_only"],
    ["inbox move of delegation (no bar)", inboxMove, { category: "delegation", categoryAuto: false }, "log_only"],
    ["move vip", move, { vip: true }, "log_only"],
    ["move vip shadow", move, { vip: true, mode: "shadow" }, "log_only"],

    // Move of unsure mail: only the move_unsure switch and move support.
    ["unsure move shadow", manualMove, { category: "unsure", mode: "shadow" }, "log_only"],
    [
      "unsure move, only move_unsure on, not auto",
      manualMove,
      { category: "unsure", toolSwitches: { ...allOff, move_unsure: true }, categoryAuto: false },
      "apply",
    ],
    [
      "unsure move, move on, move_unsure off",
      manualMove,
      { category: "unsure", toolSwitches: { ...allOn, move_unsure: false } },
      "log_only",
    ],
    ["unsure move, no move support", manualMove, { category: "unsure", movesSupported: false }, "log_only"],
    ["unsure move vip", manualMove, { category: "unsure", vip: true }, "log_only"],

    // Mark read.
    ["mark_read shadow", markRead, { mode: "shadow" }, "log_only"],
    ["mark_read assist, all on", markRead, {}, "apply"],
    ["mark_read assist, no move support", markRead, { movesSupported: false }, "apply"],
    ["mark_read assist, switch off", markRead, { toolSwitches: { ...allOn, mark_read: false } }, "log_only"],
    ["mark_read assist, category not auto", markRead, { categoryAuto: false }, "log_only"],
    ["mark_read vip", markRead, { vip: true }, "log_only"],
    ["mark_read vip shadow", markRead, { vip: true, mode: "shadow" }, "log_only"],

    // Flag.
    ["flag shadow", flag, { mode: "shadow" }, "log_only"],
    ["flag assist, switch on", flag, { toolSwitches: { ...allOff, flag: true }, categoryAuto: false }, "apply"],
    ["flag assist, switch off", flag, { toolSwitches: { ...allOn, flag: false } }, "log_only"],
    ["flag vip, switch on", flag, { vip: true }, "apply"],
    ["flag vip, switch off", flag, { vip: true, toolSwitches: { ...allOn, flag: false } }, "log_only"],
    ["flag vip shadow", flag, { vip: true, mode: "shadow" }, "log_only"],

    // Create draft: assist and the switch; VIP does not matter.
    ["create_draft assist, switch on", createDraft, {}, "apply"],
    ["create_draft assist, switch off", createDraft, { toolSwitches: { ...allOn, create_draft: false } }, "log_only"],
    ["create_draft shadow", createDraft, { mode: "shadow" }, "log_only"],
    ["create_draft vip, switch on", createDraft, { vip: true }, "apply"],
    ["create_draft assist, no move support", createDraft, { movesSupported: false }, "apply"],

    // Send: waits for approval when its draft applies.
    ["send, draft applies", send, {}, "await_approval"],
    ["send, draft switch off", send, { toolSwitches: { ...allOn, create_draft: false } }, "log_only"],
    ["send shadow", send, { mode: "shadow" }, "log_only"],
    ["send vip, switch on", send, { vip: true }, "await_approval"],
  ])("%s", (_name, action, overrides, expected) => {
    expect(decidePolicy(action, input(overrides))).toBe(expected);
  });

  test("never returns await_approval in S1b", () => {
    for (const action of allActions) {
      for (const mode of ["shadow", "assist"] as const) {
        expect(decidePolicy(action, input({ mode }))).not.toBe("await_approval");
      }
    }
  });
});

describe("decidePolicy: shadow mode", () => {
  test("no action except save_summary gets apply", () => {
    const plannable = categories.filter((category): category is Category => category !== "delegation");
    const flags = [false, true];
    for (const category of plannable) {
      for (const toolSwitches of allSwitchCombinations()) {
        for (const categoryAuto of flags) {
          for (const vip of flags) {
            for (const movesSupported of flags) {
              const policyInput: PolicyInput = {
                mode: "shadow",
                toolSwitches,
                category,
                categoryAuto,
                vip,
                movesSupported,
              };
              for (const action of allActions) {
                const expected = action.type === "save_summary" ? "apply" : "log_only";
                expect(decidePolicy(action, policyInput)).toBe(expected);
              }
            }
          }
        }
      }
    }
  });

  test("the loop covers all 32 switch combinations", () => {
    const combinations = allSwitchCombinations();
    expect(combinations).toHaveLength(32);
    expect(new Set(combinations.map((switches) => JSON.stringify(switches))).size).toBe(32);
  });
});

describe("actionStatusFor", () => {
  test("maps each decision to its action status", () => {
    expect(actionStatusFor("apply")).toBe("ready");
    expect(actionStatusFor("await_approval")).toBe("awaiting_approval");
    expect(actionStatusFor("log_only")).toBe("logged");
  });
});
