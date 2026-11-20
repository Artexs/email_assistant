import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseStyleGateArgs } from "./eval-style-gate-args";

const valid = ["--a", "a.jsonl", "--b", "b.jsonl", "--style", "s.json", "--injection", "i.json", "--out", "r.md"];

describe("parseStyleGateArgs", () => {
  test("reads the five paths", () => {
    expect(parseStyleGateArgs(valid)).toEqual({
      a: "a.jsonl",
      b: "b.jsonl",
      style: "s.json",
      injection: "i.json",
      out: "r.md",
      smoke: false,
    });
  });

  test("--smoke needs no injection file, and an injection file with it is a usage error", () => {
    const smoke = ["--smoke", "--a", "a.jsonl", "--b", "b.jsonl", "--style", "s.json", "--out", "r.md"];
    expect(parseStyleGateArgs(smoke)).toEqual({
      a: "a.jsonl",
      b: "b.jsonl",
      style: "s.json",
      injection: null,
      out: "r.md",
      smoke: true,
    });
    expect(() => parseStyleGateArgs([...smoke, "--injection", "i.json"])).toThrow(
      new UsageError("--injection is not used with --smoke")
    );
    expect(() => parseStyleGateArgs(smoke.slice(0, 7))).toThrow(new UsageError("missing argument: --out"));
  });

  test.each([
    ["a missing flag", valid.slice(2), "missing argument: --a"],
    ["two missing flags", valid.slice(0, 6), "missing argument: --injection, --out"],
    ["an empty path", [...valid.slice(0, 9), ""], "missing argument: --out"],
  ])("%s is a usage error", (_name, argv, message) => {
    expect(() => parseStyleGateArgs(argv)).toThrow(new UsageError(message));
  });

  test("an unknown flag and an operand are usage errors", () => {
    expect(() => parseStyleGateArgs([...valid, "--limit", "5"])).toThrow("Unknown option '--limit'");
    expect(() => parseStyleGateArgs([...valid, "extra"])).toThrow(new UsageError("unexpected operand"));
  });
});
