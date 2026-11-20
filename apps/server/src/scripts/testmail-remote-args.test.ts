import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTestmailRemoteArgs } from "./testmail-remote-args";

const BATCH = "2026-11-08-smoke";

describe("parseTestmailRemoteArgs", () => {
  test("deliver and compare parse their options", () => {
    expect(parseTestmailRemoteArgs(["deliver", "--batch", BATCH, "--check-only", "--dry-run"])).toEqual({
      command: "deliver",
      options: { batch: BATCH, "check-only": true, "dry-run": true, "print-input": false },
    });
    expect(parseTestmailRemoteArgs(["compare", "--batch", BATCH, "--bar", "0.9", "--out", "r.md"])).toEqual({
      command: "compare",
      options: { batch: BATCH, "check-only": false, "dry-run": false, "print-input": false, bar: 0.9, out: "r.md" },
    });
  });

  test.each([
    ["no subcommand", []],
    ["an unknown subcommand", ["nope", "--batch", BATCH]],
    ["no batch", ["deliver"]],
    ["a bad batch id", ["deliver", "--batch", "x"]],
    ["deliver with --out", ["deliver", "--batch", BATCH, "--out", "r.md"]],
    ["compare with --check-only", ["compare", "--batch", BATCH, "--check-only"]],
    ["compare with a min-kept of 0", ["compare", "--batch", BATCH, "--min-kept", "0"]],
  ])("%s throws a usage error", (_name, argv) => {
    expect(() => parseTestmailRemoteArgs(argv)).toThrow(UsageError);
  });
});
