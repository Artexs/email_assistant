import { describe, expect, test } from "bun:test";

import { parseLabArgs, usage } from "./lab-args";

describe("parseLabArgs (stage 05 test 9)", () => {
  const good: [string[], unknown][] = [
    [["seed"], { kind: "seed", org: "lab" }],
    [["seed", "--org", "demo"], { kind: "seed", org: "demo" }],
    [["reset", "--org", "lab", "--yes"], { kind: "reset", org: "lab" }],
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
    [["demo-reset", "--yes"], { kind: "demo-reset" }],
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
    ["reset", "--org", "lab"],
    ["reset", "--yes"],
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
    ["demo-reset"],
    ["demo-export", "--day", "9", "--out", "x"],
    ["demo-export", "--day", "4"],
    ["demo-import", "--file", "x", "--email", "nope"],
  ];

  test.each(bad.map((argv) => [argv]))("%p fails", (argv) => {
    expect(parseLabArgs(argv)).toBeUndefined();
  });

  test("every usage line parses to a command", () => {
    const lines = usage.split("\n").filter((line) => line.startsWith("  bun run lab "));
    expect(lines).toHaveLength(10);
    const kinds = lines.map((line) => line.trim().split(/\s+/)[3]);
    expect(new Set(kinds).size).toBe(10);
    for (const kind of kinds) expect(good.some(([argv]) => argv[0] === kind)).toBe(true);
  });
});
