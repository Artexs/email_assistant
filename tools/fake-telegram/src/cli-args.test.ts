import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseFakeTgArgs } from "./cli-args";

describe("parseFakeTgArgs", () => {
  test("press with a button is typed", () => {
    expect(parseFakeTgArgs(["press", "--button", "OK"])).toEqual({
      command: "press",
      url: undefined,
      json: false,
      chatId: undefined,
      messageId: undefined,
      button: "OK",
      data: undefined,
      timeoutSeconds: undefined,
    });
  });

  test("wait keeps its operand and takes a negative chat", () => {
    expect(parseFakeTgArgs(["wait", "hi", "--chat", "-100", "--json"])).toEqual({
      command: "wait",
      url: undefined,
      json: true,
      pattern: /hi/s,
      chatId: -100,
      timeoutSeconds: 30,
      afterMessageId: undefined,
    });
  });

  test.each([
    [["press"], "press needs exactly one of --button and --data"],
    [["press", "--button", "a", "--data", "b"], "press needs exactly one of --button and --data"],
    [["read", "--last", "-1"], "argument is ambiguous"],
    [["read", "--last=-1"], '--last needs a whole number, got "-1"'],
    [["nope"], 'unknown command "nope"'],
    [[], "needs a command"],
    [["serve", "x"], "serve takes no argument"],
    [["send"], "send needs one <text>"],
    [["wait", "("], "bad regex"],
    [["read", "--no-such-flag"], "Unknown option"],
  ])("%j is a usage error", (argv, message) => {
    expect(() => parseFakeTgArgs(argv)).toThrow(UsageError);
    expect(() => parseFakeTgArgs(argv)).toThrow(message);
  });
});

describe("fake-tg imports", () => {
  // compat.test.ts imports the real adapter on purpose: a test may, the shipped code may not.
  test("no shipped source file imports apps/ or a path outside tools/", () => {
    const toolRoot = join(import.meta.dir, "..");
    const bad: string[] = [];
    for (const file of readdirSync(import.meta.dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
    )) {
      const text = readFileSync(join(import.meta.dir, file), "utf8");
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const specifier = match[1] as string;
        const leavesTools =
          specifier.startsWith(".") && !join(import.meta.dir, specifier).startsWith(join(toolRoot, ".."));
        if (specifier.startsWith("apps/") || specifier.includes("/apps/") || leavesTools) {
          bad.push(`${file}: ${specifier}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
