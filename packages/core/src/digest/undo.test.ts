import { describe, expect, test } from "bun:test";

import { isUndoable, UNDO_WINDOW_MS } from "./undo";
import type { ActionView } from "./would-do";

const NOW = new Date("2026-11-07T12:00:00Z");
const HOUR = 3_600_000;

function view(id: string, over: Partial<ActionView> = {}): ActionView {
  return {
    id,
    type: "move",
    status: "applied",
    folder: "ai_info",
    reverse: false,
    reversesActionId: null,
    appliedAt: new Date(NOW.getTime() - HOUR),
    ...over,
  };
}

describe("isUndoable", () => {
  test("an applied move inside the window is undoable", () => {
    expect(isUndoable([view("a")], NOW)).toBe(true);
  });

  test("flag and mark_read count too", () => {
    expect(isUndoable([view("a", { type: "flag", folder: null })], NOW)).toBe(true);
    expect(isUndoable([view("a", { type: "mark_read", folder: null })], NOW)).toBe(true);
  });

  test("a reverse row of the original makes it false", () => {
    const reverse = view("r", { reverse: true, reversesActionId: "a", status: "ready", appliedAt: null });
    expect(isUndoable([view("a"), reverse], NOW)).toBe(false);
  });

  test("another undoable original keeps it true", () => {
    const reverse = view("r", { reverse: true, reversesActionId: "a", status: "ready", appliedAt: null });
    expect(isUndoable([view("a"), reverse, view("b", { type: "flag", folder: null })], NOW)).toBe(true);
  });

  test("applied 8 days ago is false; the window edge is true", () => {
    expect(isUndoable([view("a", { appliedAt: new Date(NOW.getTime() - 8 * 24 * HOUR) })], NOW)).toBe(false);
    expect(isUndoable([view("a", { appliedAt: new Date(NOW.getTime() - UNDO_WINDOW_MS) })], NOW)).toBe(true);
  });

  test("only save_summary applied is false", () => {
    expect(isUndoable([view("a", { type: "save_summary", folder: null })], NOW)).toBe(false);
  });

  test("logged and undone originals are false", () => {
    expect(isUndoable([view("a", { status: "logged", appliedAt: null })], NOW)).toBe(false);
    expect(isUndoable([view("a", { status: "undone" })], NOW)).toBe(false);
  });
});
