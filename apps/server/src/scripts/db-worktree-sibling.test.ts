import { describe, expect, test } from "bun:test";

import { siblingDatabaseName } from "./db-worktree-args";

describe("siblingDatabaseName", () => {
  test("adds the e2e tail and the database prefix", () => {
    expect(siblingDatabaseName("e2e")).toBe("email_assistant_e2e_e2e");
    expect(siblingDatabaseName("f136t-abc")).toBe("email_assistant_f136t_abc_e2e");
  });

  test("is null when the sibling name is too long", () => {
    expect(siblingDatabaseName("a".repeat(45))).toBeNull();
  });
});
