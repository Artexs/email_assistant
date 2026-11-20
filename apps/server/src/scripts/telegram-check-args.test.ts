import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTelegramCheckArgs } from "./telegram-check-args";

describe("parseTelegramCheckArgs", () => {
  test("no argument is valid", () => {
    expect(parseTelegramCheckArgs([])).toBeUndefined();
  });

  test.each([
    ["a flag", ["--no-such-flag"]],
    ["an operand", ["extra"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseTelegramCheckArgs(argv)).toThrow(UsageError);
  });
});
