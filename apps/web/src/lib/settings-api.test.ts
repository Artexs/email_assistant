/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { selectedMailboxId, settingsPath, switchesAfterAssist } from "./settings-api";

describe("selectedMailboxId", () => {
  test("returns the query id when it is listed", () => {
    expect(selectedMailboxId([{ id: "a" }, { id: "b" }], "b")).toBe("b");
  });

  test("falls back to the first mailbox when the query id is not listed", () => {
    expect(selectedMailboxId([{ id: "a" }, { id: "b" }], "x")).toBe("a");
    expect(selectedMailboxId([{ id: "a" }, { id: "b" }], null)).toBe("a");
  });

  test("returns null for an empty list", () => {
    expect(selectedMailboxId([], null)).toBeNull();
  });
});

describe("switchesAfterAssist", () => {
  const current = { move: false, mark_read: false, flag: false, create_draft: true, move_unsure: true };

  test("the usual switches: move, mark_read, flag on, move_unsure off, create_draft kept", () => {
    expect(switchesAfterAssist(current, false)).toEqual(["move", "mark_read", "flag", "create_draft"]);
  });

  test("keep: the switches that are on now", () => {
    expect(switchesAfterAssist(current, true)).toEqual(["create_draft", "move_unsure"]);
  });
});

describe("settingsPath", () => {
  test("encodes the id and appends the tail", () => {
    expect(settingsPath("a b")).toBe("/api/settings/a%20b");
    expect(settingsPath("a", "/mode")).toBe("/api/settings/a/mode");
  });
});
