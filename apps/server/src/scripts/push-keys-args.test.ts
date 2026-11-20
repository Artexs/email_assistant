import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parsePushKeysArgs } from "./push-keys-args";

describe("parsePushKeysArgs", () => {
  test("no argument is valid", () => {
    expect(parsePushKeysArgs([])).toBeUndefined();
  });

  test.each([
    ["a flag", ["--write"]],
    ["an operand", ["extra"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parsePushKeysArgs(argv)).toThrow(UsageError);
  });
});
