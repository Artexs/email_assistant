import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseFlags } from "./parse-flags";

const options = { port: { type: "string" }, probe: { type: "boolean" } } as const;

describe("parseFlags", () => {
  test("a valid argv gives the values", () => {
    expect(parseFlags({ args: ["--port", "1", "--probe"], options }).values).toEqual({ port: "1", probe: true });
  });

  test.each([
    ["an unknown flag", ["--password"], "Unknown option '--password'"],
    ["an unknown flag with a value", ["--password=hunter2"], "Unknown option '--password'"],
    ["an option with no value", ["--port"], "Option '--port <value>' argument missing"],
    ["a value for a boolean", ["--probe=yes"], "Option '--probe' does not take an argument"],
    ["an operand", ["hunter2"], "unexpected operand"],
  ])("%s is a UsageError that holds no value", (_label, args, message) => {
    expect(() => parseFlags({ args, options })).toThrow(new UsageError(message));
  });
});
