import { describe, expect, test } from "bun:test";

import type { ActionType, FolderKey } from "../triage/planners";

import { type ActionView, describeActions } from "./would-do";

function act(type: ActionType, status: string, folder: FolderKey | null = null, reverse = false): ActionView {
  return { id: "a1", type, status, folder, reverse, reversesActionId: reverse ? "a0" : null, appliedAt: null };
}

describe("describeActions", () => {
  test.each<[string, ActionView[], string]>([
    ["flag logged", [act("flag", "logged")], "would flag"],
    [
      "save_summary is ignored",
      [act("save_summary", "ready"), act("move", "logged", "ai_info")],
      "would move to AI/Info",
    ],
    [
      "same tense is grouped",
      [act("mark_read", "logged"), act("move", "logged", "ai_notifications")],
      "would mark read, move to AI/Notifications",
    ],
    ["no actions", [], "stays in INBOX"],
    ["mixed tenses", [act("flag", "applied"), act("move", "logged", "ai_info")], "done: flag; would move to AI/Info"],
    ["move without folder", [act("move", "logged")], "would move"],
    ["undone original", [act("move", "undone", "ai_info")], "undone: move to AI/Info"],
    [
      "reverse row is skipped",
      [act("move", "undone", "ai_info"), act("move", "applied", "ai_info", true)],
      "undone: move to AI/Info",
    ],
    ["rejected is left out", [act("flag", "rejected")], "stays in INBOX"],
  ])("%s", (_name, actions, expected) => {
    expect(describeActions(actions)).toBe(expected);
  });
});
