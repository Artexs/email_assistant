// Every action type is complete. The CHECK list of actions.type is compared in apps/server/test/integration/actions-transitions.test.ts.
import { actionTypes, describeAction, textTables, type ActionType, type PlannedAction } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { APPLY_HANDLERS } from "./apply";
import { ACTION_EDGES, ACTION_ENTRIES } from "./transitions";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Typecheck fails here when the planner's union and actionTypes differ.
const plannedMatchesTypes: Same<PlannedAction["type"], ActionType> = true;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
// A summary is stored, not shown as a line.
const NO_PHRASE: readonly ActionType[] = ["save_summary"];

const PHRASES: Partial<Record<ActionType, string>> = {
  move: "would move to AI/Info",
  mark_read: "would mark read",
  flag: "would flag",
  create_draft: "would draft a delegation to a delegate",
  send: "would ask you to send it",
};

const NONE = { provider: false, sender: false, facts: false, sortFolders: false };
const IMAP = { provider: true, sender: false, facts: false, sortFolders: false };
const EXPECTED_NEEDS = {
  move: { ...IMAP, sortFolders: true },
  mark_read: IMAP,
  flag: IMAP,
  save_summary: NONE,
  create_draft: { ...IMAP, facts: true },
  send: { ...IMAP, sender: true, facts: true },
};

describe("every action type is complete", () => {
  test("the planner's union is the type list", () => {
    expect(plannedMatchesTypes).toBe(true);
  });

  test("each type has one apply handler", () => {
    expect(sorted(Object.keys(APPLY_HANDLERS))).toEqual(sorted(actionTypes));
    expect(Object.keys(APPLY_HANDLERS)).toHaveLength(6);
  });

  test("each type has an entry that createPlanned writes", () => {
    const types = ACTION_ENTRIES.filter((entry) => entry.writer === "createPlanned").flatMap((entry) => entry.types);
    expect(sorted(types)).toEqual(sorted(actionTypes));
  });

  test("each type has at least one edge", () => {
    expect(sorted(ACTION_EDGES.flatMap((edge) => edge.types))).toEqual(sorted(actionTypes));
  });

  test("each type has a digest phrase", () => {
    for (const type of actionTypes) {
      const phrase = describeAction(
        {
          type,
          status: "logged",
          folder: type === "move" ? "ai_info" : null,
          reverse: false,
          kind: type === "create_draft" || type === "send" ? "delegation" : null,
          delegateId: null,
        },
        new Map(),
        textTables.en
      );
      if (NO_PHRASE.includes(type)) {
        expect(phrase).toBeNull();
        continue;
      }
      expect(typeof phrase).toBe("string");
      expect(phrase).not.toContain("undefined");
      expect(phrase).toBe(PHRASES[type] ?? "");
    }
  });

  test("the needs of each type", () => {
    expect(Object.fromEntries(actionTypes.map((type) => [type, APPLY_HANDLERS[type].needs]))).toEqual(EXPECTED_NEEDS);
  });

  test("only send opens SMTP", () => {
    expect(actionTypes.filter((type) => APPLY_HANDLERS[type].needs.sender)).toEqual(["send"]);
  });
});
