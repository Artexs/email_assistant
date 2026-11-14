import { describe, expect, test } from "bun:test";

import { parseSimArgs, usage } from "./sim-args";

describe("parseSimArgs", () => {
  test("plan and status", () => {
    expect(parseSimArgs(["plan", "lab-01"])).toEqual({ kind: "plan", scenario: "lab-01", force: false });
    expect(parseSimArgs(["plan", "lab-01", "--force", "--root", "/tmp/x"])).toEqual({
      kind: "plan",
      scenario: "lab-01",
      root: "/tmp/x",
      force: true,
    });
    expect(parseSimArgs(["status", "lab-01"])).toEqual({ kind: "status", scenario: "lab-01" });
  });

  test("4 an unknown command, a missing scenario or a missing --root value gives undefined", () => {
    expect(parseSimArgs(["frobnicate", "lab-01"])).toBeUndefined();
    expect(parseSimArgs([])).toBeUndefined();
    expect(parseSimArgs(["plan"])).toBeUndefined();
    expect(parseSimArgs(["plan", "lab-01", "--root"])).toBeUndefined();
    expect(parseSimArgs(["plan", "lab-01", "--root", ""])).toBeUndefined();
    expect(usage).toContain("bun run sim plan");
  });

  test("a scenario id is a plain folder name", () => {
    expect(parseSimArgs(["status", "../etc"])).toBeUndefined();
    expect(parseSimArgs(["status", "Lab_01"])).toBeUndefined();
  });

  test("brief, label-import and the range commands", () => {
    expect(parseSimArgs(["brief", "lab-01", "--part", "dev", "--batch", "003"])).toEqual({
      kind: "brief",
      scenario: "lab-01",
      part: "dev",
      batch: 3,
    });
    expect(parseSimArgs(["check", "lab-01"])).toEqual({ kind: "check", scenario: "lab-01" });
    expect(parseSimArgs(["check", "lab-01", "--part", "week", "--batches", "001-004"])).toEqual({
      kind: "check",
      scenario: "lab-01",
      part: "week",
      range: { from: 1, to: 4 },
    });
    expect(parseSimArgs(["stale", "lab-01", "--part", "dev", "--batches", "2-2"])).toMatchObject({
      kind: "stale",
      range: { from: 2, to: 2 },
    });
    expect(
      parseSimArgs([
        "label-import",
        "lab-01",
        "--part",
        "dev",
        "--batch",
        "1",
        "--checker",
        "claude-haiku-5-5",
        "--file",
        "/tmp/f097-s19/labels-001.json",
      ])
    ).toMatchObject({ kind: "label-import", checker: "claude-haiku-5-5", file: "/tmp/f097-s19/labels-001.json" });
  });

  test("a flag of another command, a bad part or a bad range gives undefined", () => {
    expect(parseSimArgs(["plan", "lab-01", "--part", "dev"])).toBeUndefined();
    expect(parseSimArgs(["brief", "lab-01", "--part", "nope", "--batch", "1"])).toBeUndefined();
    expect(parseSimArgs(["brief", "lab-01", "--part", "dev"])).toBeUndefined();
    expect(parseSimArgs(["reconcile", "lab-01", "--part", "dev", "--batches", "3-1"])).toBeUndefined();
    expect(parseSimArgs(["reconcile", "lab-01", "--part", "dev"])).toBeUndefined();
    expect(parseSimArgs(["blind-export", "lab-01", "--part", "dev", "--batches", "0-2"])).toBeUndefined();
    expect(parseSimArgs(["label-import", "lab-01", "--part", "dev", "--batch", "1", "--checker", "m"])).toBeUndefined();
  });
});
