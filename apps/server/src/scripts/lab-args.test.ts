import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseLabArgs, usage } from "./lab-args";

describe("parseLabArgs (stage 05 test 9)", () => {
  const good: [string[], unknown][] = [
    [["seed"], { kind: "seed", org: "lab" }],
    [["seed", "--org", "demo"], { kind: "seed", org: "demo" }],
    [["reset", "--org", "lab", "--yes"], { kind: "reset", org: "lab", yes: true }],
    // Without --yes the command prints what it would delete and exits 1 (`confirm_needed`).
    [["reset", "--org", "demo"], { kind: "reset", org: "demo", yes: false }],
    [["start", "--mode", "day"], { kind: "start", mode: "day", org: "lab", reuse: false }],
    [
      ["start", "--mode", "week", "--date", "2026-11-23", "--org", "demo", "--cap-usd", "3.5", "--reuse"],
      { kind: "start", mode: "week", date: "2026-11-23", org: "demo", capUsd: 3.5, reuse: true },
    ],
    [["status"], { kind: "status" }],
    [["status", "--run", "day-20261123-ab12"], { kind: "status", runId: "day-20261123-ab12" }],
    [["stop", "--run", "day-20261123-ab12"], { kind: "stop", runId: "day-20261123-ab12" }],
    [["serve"], { kind: "serve" }],
    [
      ["score", "--run", "week-20261123-ab12", "--out", "/tmp/x"],
      { kind: "score", runId: "week-20261123-ab12", out: "/tmp/x" },
    ],
    [["demo-reset", "--yes"], { kind: "demo-reset", yes: true }],
    [["demo-reset"], { kind: "demo-reset", yes: false }],
    [["demo-reset", "--date", "2026-11-23", "--yes"], { kind: "demo-reset", yes: true, date: "2026-11-23" }],
    [["demo-export", "--day", "4", "--out", "/tmp/demo.json"], { kind: "demo-export", day: 4, out: "/tmp/demo.json" }],
    [
      ["demo-import", "--file", "/tmp/demo.json", "--email", "Anna@Dev.test", "--replace"],
      { kind: "demo-import", file: "/tmp/demo.json", email: "anna@dev.test", replace: true },
    ],
  ];

  test.each(good)("%p parses", (argv, expected) => {
    expect(parseLabArgs(argv)).toEqual(expected as never);
  });

  const bad: string[][] = [
    [],
    ["nope"],
    ["seed", "extra"],
    ["seed", "--bogus"],
    ["seed", "--yes"],
    ["serve", "--org", "lab"],
    ["reset", "--yes"],
    ["reset"],
    ["reset", "--org", "prod", "--yes"],
    ["reset", "--org", "lab", "--date", "2026-11-23"],
    ["start"],
    ["start", "--mode", "month"],
    ["start", "--mode", "day", "--date", "23-11-2026"],
    ["start", "--mode", "day", "--cap-usd", "0"],
    ["start", "--mode", "day", "--cap-usd", "-1"],
    ["start", "--mode", "day", "--cap-usd", "abc"],
    ["start", "--mode", "day", "--org", "prod"],
    ["stop"],
    ["stop", "--run", "../evil"],
    ["score"],
    ["demo-reset", "--date", "23-11-2026"],
    ["demo-reset", "--org", "lab"],
    ["demo-export", "--day", "9", "--out", "x"],
    ["demo-export", "--day", "4"],
    ["demo-import", "--file", "x", "--email", "nope"],
  ];

  // `runCli` maps both kinds to exit 2: a `UsageError` (bad value) and a `parseArgs` error (bad flag).
  const isUsageFailure = (error: unknown): boolean =>
    error instanceof UsageError || String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS_");

  test.each(bad.map((argv) => [argv]))("%p is a usage failure", (argv) => {
    let thrown: unknown;
    try {
      parseLabArgs(argv);
    } catch (error) {
      thrown = error;
    }
    expect({ argv, usageFailure: isUsageFailure(thrown) }).toEqual({ argv, usageFailure: true });
  });

  test("an unknown flag is refused by the parser, which `runCli` maps to exit 2", () => {
    expect(() => parseLabArgs(["--no-such-flag"])).toThrow(
      expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" })
    );
  });

  test("every usage line parses to a command", () => {
    const lines = usage
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("bun run lab "));
    expect(lines).toHaveLength(10);
    const kinds = lines.map((line) => line.trim().split(/\s+/)[3]);
    expect(new Set(kinds).size).toBe(10);
    for (const kind of kinds) expect(good.some(([argv]) => argv[0] === kind)).toBe(true);
  });
});
