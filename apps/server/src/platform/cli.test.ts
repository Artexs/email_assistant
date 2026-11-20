import { parseArgs } from "node:util";

import { type CliDescription, renderHelp, UsageError } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createCliOutput, exitCodeOf, runCliCode } from "./cli";
import { SoftError } from "./errors";
import { setLogFormat, setLogLevel } from "./log";

describe("createCliOutput", () => {
  let logSpy: ReturnType<typeof spyOn<Console, "log">>;
  let errorSpy: ReturnType<typeof spyOn<Console, "error">>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    setLogLevel("info");
    setLogFormat("text");
  });

  test("print goes to console.log and fail to console.error, with the name prefix", () => {
    const out = createCliOutput("rules");
    out.print("added rule 3");
    out.fail("refused: x");
    expect(logSpy.mock.calls).toEqual([["[rules]", "added rule 3"]]);
    expect(errorSpy.mock.calls).toEqual([["[rules]", "refused: x"]]);
  });

  test("raw goes to console.log with no prefix", () => {
    createCliOutput("stats-week").raw("m3_total 4 hidden 2");
    expect(logSpy.mock.calls).toEqual([["m3_total 4 hidden 2"]]);
    expect(errorSpy.mock.calls).toEqual([]);
  });

  test("the log level and the log format do not change the output", () => {
    setLogLevel("error");
    setLogFormat("json");
    createCliOutput("rules").print("added rule 3");
    expect(logSpy.mock.calls).toEqual([["[rules]", "added rule 3"]]);
  });
});

describe("runCliCode", () => {
  const add: CliDescription = {
    name: "rules:add",
    subcommand: "add",
    summary: "Adds a rule.",
    risk: "write",
    needs: ["db"],
    usage: "bun run rules:add --org-id <uuid>",
  };
  const list: CliDescription = {
    name: "rules:list",
    subcommand: "list",
    summary: "Lists rules.",
    risk: "read",
    needs: ["db"],
    usage: "bun run rules:list --org-id <uuid>",
  };
  const one: CliDescription = { ...add, name: "x", subcommand: undefined, usage: "bun run x --org-id <uuid>" };

  let stdout: string[];
  let stderr: string[];
  let spies: { mockRestore(): void }[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    spies = [
      spyOn(process.stdout, "write").mockImplementation((text) => {
        stdout.push(String(text));
        return true;
      }),
      spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdout.push(`${args.join(" ")}\n`);
      }),
      spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        stderr.push(`${args.join(" ")}\n`);
      }),
    ];
  });

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  function run(main: (argv: string[], out: ReturnType<typeof createCliOutput>) => Promise<number>, extra = {}) {
    let closed = 0;
    const calls: string[][] = [];
    const code = runCliCode({
      prefix: "x",
      descriptions: [one],
      argv: ["--org-id", "1"],
      close: async () => {
        closed += 1;
      },
      main: async (argv, out) => {
        calls.push(argv);
        return main(argv, out);
      },
      ...extra,
    });
    return { code, calls, closed: () => closed };
  }

  test("--help prints the help on stdout, returns 0 and does not call main", async () => {
    const { code, calls } = run(async () => 0, { argv: ["--help"] });
    expect(await code).toBe(0);
    expect(stdout.join("")).toBe(renderHelp(one));
    expect(calls).toEqual([]);
  });

  test("-h with a subcommand prints only that description", async () => {
    const code = await runCliCode({
      prefix: "rules",
      descriptions: [add, list],
      argv: ["add", "--help"],
      main: async () => 0,
    });
    expect(code).toBe(0);
    expect(stdout.join("")).toBe(renderHelp(add));
    stdout = [];
    expect(await runCliCode({ prefix: "rules", descriptions: [add, list], argv: ["-h"], main: async () => 0 })).toBe(0);
    expect(stdout.join("")).toBe(`${renderHelp(add)}\n${renderHelp(list)}`);
  });

  test("a UsageError returns 2 with the message and the usage line", async () => {
    const { code, closed } = run(async () => {
      throw new UsageError("missing --org-id");
    });
    expect(await code).toBe(2);
    expect(stderr).toEqual(["[x] missing --org-id\n", "[x] usage: bun run x --org-id <uuid>\n"]);
    expect(closed()).toBe(1);
  });

  test("a parseArgs error returns 2", async () => {
    const { code, closed } = run(async () => {
      parseArgs({ args: ["--nope"], options: {} });
      return 0;
    });
    expect(await code).toBe(2);
    expect(stderr).toHaveLength(2);
    expect(stderr[1]).toBe("[x] usage: bun run x --org-id <uuid>\n");
    expect(closed()).toBe(1);
  });

  test("an unreachable error returns 3 with one unreachable line", async () => {
    const { code, closed } = run(async () => {
      throw Object.assign(new Error("connect to 10.0.0.1 failed"), { code: "ECONNREFUSED" });
    });
    expect(await code).toBe(3);
    expect(stderr).toEqual(["[x] unreachable: Error ECONNREFUSED\n"]);
    expect(closed()).toBe(1);
  });

  test("any other error returns 1 and does not print its message or a stack", async () => {
    const { code, closed } = run(async () => {
      throw new Error("secret text");
    });
    expect(await code).toBe(1);
    expect(stderr).toEqual(["[x] failed: Error\n"]);
    expect(stderr.join("")).not.toContain("secret text");
    expect(closed()).toBe(1);
  });

  test("main's number is returned as is and close runs once", async () => {
    const { code, closed } = run(async () => 4);
    expect(await code).toBe(4);
    expect(closed()).toBe(1);
  });

  test("a close error is swallowed after one line", async () => {
    const code = await runCliCode({
      prefix: "x",
      descriptions: [one],
      argv: [],
      main: async () => 0,
      close: async () => {
        throw new Error("pool gone");
      },
    });
    expect(code).toBe(0);
    expect(stderr).toEqual(["[x] close failed: Error\n"]);
  });

  test("json writes one value; a second call throws; with json: true print goes to stderr", () => {
    const out = createCliOutput("x");
    out.json({ a: 1 });
    expect(stdout).toEqual(['{"a":1}\n']);
    expect(() => out.json({ b: 2 })).toThrow();
    createCliOutput("x", { json: true }).print("a");
    expect(stderr).toEqual(["[x] a\n"]);
    expect(stdout).toHaveLength(1);
  });

  test("write and writeErr keep the exact bytes", () => {
    const out = createCliOutput("x");
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    out.write("a\tb");
    out.writeErr("c");
    expect(stdout).toEqual(["a\tb"]);
    expect(errSpy.mock.calls).toEqual([["c"]]);
    errSpy.mockRestore();
  });

  test("a -h after -- is an operand: main runs with that argv and no help is printed", async () => {
    const { code, calls } = run(async () => 0, { argv: ["send", "--", "-h"] });
    expect(await code).toBe(0);
    expect(calls).toEqual([["send", "--", "-h"]]);
    expect(stdout).toEqual([]);
  });

  test("--json gives main an out whose print goes to stderr", async () => {
    const { code } = run(
      async (_argv, out) => {
        out.print("a");
        return 0;
      },
      { argv: ["--json"] }
    );
    expect(await code).toBe(0);
    expect(stderr).toEqual(["[x] a\n"]);
    expect(stdout).toEqual([]);
  });
});

describe("exitCodeOf", () => {
  test("is 3 for an unreachable code, a SoftError, a pool connect timeout and a cause with such a code", () => {
    expect(exitCodeOf({ code: "57P03" })).toBe(3);
    expect(exitCodeOf(new SoftError("slow"))).toBe(3);
    expect(exitCodeOf(new Error("timeout exceeded when trying to connect"))).toBe(3);
    expect(exitCodeOf(new Error("outer", { cause: { code: "ECONNRESET" } }))).toBe(3);
  });

  test("is 1 for any other error", () => {
    expect(exitCodeOf(new Error("x"))).toBe(1);
    expect(exitCodeOf("text")).toBe(1);
    expect(exitCodeOf(null)).toBe(1);
  });
});
