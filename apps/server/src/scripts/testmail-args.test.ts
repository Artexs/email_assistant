import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTestmailArgs } from "./testmail-args";

const BATCH = "2026-11-08-smoke";

describe("parseTestmailArgs", () => {
  test.each([
    ["setup", ["setup"], { command: "setup", options: {} }],
    [
      "validate",
      ["validate", "--batch", BATCH],
      { command: "validate", options: { batch: BATCH, "allow-unlabelled": false } },
    ],
    [
      "validate with --allow-unlabelled",
      ["validate", "--batch", BATCH, "--allow-unlabelled"],
      { command: "validate", options: { batch: BATCH, "allow-unlabelled": true } },
    ],
    ["blind view", ["blind", "--batch", BATCH], { command: "blind", options: { batch: BATCH } }],
    [
      "blind apply",
      ["blind", "--batch", BATCH, "--apply", "labels.json", "--checker", "haiku"],
      { command: "blind", options: { batch: BATCH, apply: "labels.json", checker: "haiku" } },
    ],
    [
      "send with the defaults",
      ["send", "--batch", BATCH],
      { command: "send", options: { batch: BATCH, "interval-sec": 30, "daily-cap": 50, "dry-run": false } },
    ],
    [
      "send with every option",
      ["send", "--batch", BATCH, "--limit", "3", "--interval-sec", "5", "--daily-cap", "95", "--dry-run"],
      { command: "send", options: { batch: BATCH, limit: 3, "interval-sec": 5, "daily-cap": 95, "dry-run": true } },
    ],
    ["status", ["status", "--batch", BATCH], { command: "status", options: { batch: BATCH } }],
  ])("%s parses", (_name, argv, expected) => {
    expect(parseTestmailArgs(argv)).toEqual(expected as ReturnType<typeof parseTestmailArgs>);
  });

  test.each([
    ["no subcommand", []],
    ["an unknown subcommand", ["nope"]],
    ["send with an empty batch", ["send", "--batch", ""]],
    ["send with no batch", ["send"]],
    ["send with a bad interval", ["send", "--batch", BATCH, "--interval-sec", "4"]],
    ["send with a daily cap over 95", ["send", "--batch", BATCH, "--daily-cap", "96"]],
    ["blind with --apply and no --checker", ["blind", "--batch", BATCH, "--apply", "labels.json"]],
    ["setup with a batch", ["setup", "--batch", BATCH]],
    ["status with --dry-run", ["status", "--batch", BATCH, "--dry-run"]],
  ])("%s throws a usage error", (_name, argv) => {
    expect(() => parseTestmailArgs(argv)).toThrow(UsageError);
  });

  test("an unknown flag throws a parse error that runCli maps to exit 2", () => {
    expect(() => parseTestmailArgs(["status", "--batch", BATCH, "--no-such-flag"])).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" })
    );
  });
});
