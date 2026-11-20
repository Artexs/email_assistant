import { describe, expect, test } from "bun:test";

import {
  CLI_NEEDS,
  type CliDescription,
  cliDescriptionSchema,
  type CliToolRow,
  renderHelp,
  renderToolTable,
  UsageError,
} from "./index";

const orgStatus: CliDescription = {
  name: "org:status",
  summary: "Prints one organization.",
  risk: "read",
  needs: ["db"],
  usage: "bun run org:status --org-id <uuid>",
};

describe("renderHelp", () => {
  test("prints the four fixed lines", () => {
    expect(renderHelp(orgStatus)).toBe(
      [
        "usage: bun run org:status --org-id <uuid>",
        "Prints one organization.",
        "risk: read · needs: db",
        "exit: 0 done · 1 failed · 2 usage · 3 unreachable · 4 incomplete",
        "",
      ].join("\n")
    );
  });

  test("adds one line per exit text, then the output note", () => {
    const help = renderHelp({
      ...orgStatus,
      needs: ["db", "imap"],
      exits: { 1: "the organization is missing", 4: "stopped at the cap" },
      outputNote: "prints one address",
    });
    const lines = help.split("\n");
    expect(lines[2]).toBe("risk: read · needs: db, imap");
    expect(lines[4]).toBe("  1: the organization is missing");
    expect(lines[5]).toBe("  4: stopped at the cap");
    expect(lines[6]).toBe("output: prints one address");
    expect(help.endsWith("\n")).toBe(true);
  });
});

describe("cliDescriptionSchema", () => {
  test("accepts a valid description, a subcommand and exits", () => {
    expect(cliDescriptionSchema.safeParse(orgStatus).success).toBe(true);
    expect(
      cliDescriptionSchema.safeParse({
        ...orgStatus,
        name: "rules:add",
        subcommand: "add",
        usage: "bun run rules:add --org-id <uuid>\n  more lines are allowed",
        exits: { 1: "refused" },
      }).success
    ).toBe(true);
  });

  test.each([
    ["a summary of 101 characters", { summary: `${"a".repeat(100)}.` }],
    ["a summary with no final dot", { summary: "Prints one organization" }],
    ["needs none with another need", { needs: ["none", "db"] }],
    ["empty needs", { needs: [] }],
    ["a usage with no run", { usage: "bun org:status" }],
    ["a usage with a usage: prefix", { usage: "usage: bun run org:status" }],
    ["a usage for another tool", { usage: "bun run org:delete" }],
    ["a risk that is not in the list", { risk: "admin" }],
    ["a name with a space", { name: "org status", usage: "bun run org status" }],
    ["an exit text for code 2", { exits: { 2: "usage" } }],
  ])("refuses %s", (_label, change) => {
    expect(cliDescriptionSchema.safeParse({ ...orgStatus, ...change }).success).toBe(false);
  });

  test("a summary of exactly 100 characters passes", () => {
    expect(cliDescriptionSchema.safeParse({ ...orgStatus, summary: `${"a".repeat(99)}.` }).success).toBe(true);
  });
});

describe("cliDescriptionSchema issues and edges", () => {
  const issuesOf = (change: Record<string, unknown>) => {
    const result = cliDescriptionSchema.safeParse({ ...orgStatus, ...change });
    if (result.success) return [];
    return result.error.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message }));
  };

  test.each([
    ["Add", false],
    ["add:user", false],
    ["add-", false],
    ["-add", false],
    ["add user", false],
    ["", false],
    ["add\n", false],
  ])("the subcommand %j is ok = %s", (subcommand, ok) => {
    expect(cliDescriptionSchema.safeParse({ ...orgStatus, subcommand }).success).toBe(ok);
  });

  test("a name that breaks the pattern gets the package.json message", () => {
    expect(issuesOf({ name: "Org", usage: "bun run Org" })).toEqual([
      {
        code: "invalid_format",
        path: ["name"],
        message: "name is a package.json key: kebab-case parts joined by ':'",
      },
    ]);
  });

  test.each([
    {
      name: "a summary over the limit",
      change: { summary: `${"a".repeat(100)}.` },
      issues: [{ code: "too_big", path: ["summary"], message: "summary is at most 100 characters" }],
    },
    {
      name: "a summary with no final dot",
      change: { summary: "Prints one organization" },
      issues: [{ code: "invalid_format", path: ["summary"], message: "summary is one sentence that ends with '.'" }],
    },
    {
      name: "a summary that starts with a space",
      change: { summary: " Prints one organization." },
      issues: [{ code: "invalid_format", path: ["summary"], message: "summary is one sentence that ends with '.'" }],
    },
    {
      name: "a summary of two lines",
      change: { summary: "Prints one.\nPrints two." },
      issues: [
        { code: "invalid_format", path: ["summary"], message: "summary is one sentence that ends with '.'" },
        { code: "custom", path: ["summary"], message: "summary is one line" },
      ],
    },
    {
      name: "needs with a duplicate",
      change: { needs: ["db", "db"] },
      issues: [{ code: "custom", path: ["needs"], message: "needs has no duplicate" }],
    },
    {
      name: "none next to another need",
      change: { needs: ["none", "db"] },
      issues: [{ code: "custom", path: ["needs"], message: "'none' stands alone" }],
    },
    {
      name: "a usage that does not start with bun run",
      change: { usage: "bun org:status" },
      issues: [
        { code: "custom", path: ["usage"], message: "usage starts with 'bun run <name>'" },
        { code: "custom", path: ["usage"], message: "usage first line names the tool" },
      ],
    },
    {
      name: "a usage with text before bun run",
      change: { usage: "x bun run org:status" },
      issues: [
        { code: "custom", path: ["usage"], message: "usage starts with 'bun run <name>'" },
        { code: "custom", path: ["usage"], message: "usage first line names the tool" },
      ],
    },
    {
      name: "a usage for another tool",
      change: { usage: "bun run org:delete" },
      issues: [{ code: "custom", path: ["usage"], message: "usage first line names the tool" }],
    },
  ])("refuses $name with its exact issues", ({ change, issues }) => {
    expect<unknown>(issuesOf(change)).toEqual(issues);
  });

  test("refuses an empty output note", () => {
    expect(cliDescriptionSchema.safeParse({ ...orgStatus, outputNote: "" }).success).toBe(false);
  });

  test.each([
    ["every need but none", { needs: CLI_NEEDS.filter((need) => need !== "none") }],
    ["none as the only need", { needs: ["none"] }],
  ])("accepts %s", (_label, change) => {
    expect(cliDescriptionSchema.safeParse({ ...orgStatus, ...change }).success).toBe(true);
  });
});

describe("renderToolTable", () => {
  const row = (name: string, summary: string, available = true) => ({
    name,
    risk: "read" as const,
    needs: ["db"] as const,
    summary,
    available,
  });

  test("prints rows sorted by name in padded columns", () => {
    expect(renderToolTable([row("org:status", "Two."), row("job:run", "One.")])).toBe(
      ["job:run     read  db  One.", "org:status  read  db  Two.", ""].join("\n")
    );
  });

  test("an unavailable row prints dashes and the install note", () => {
    const table = renderToolTable([row("fake-tg", "Hidden.", false), row("job:run", "One.")]);
    expect(table).toContain("fake-tg  -     -   not in this install");
    expect(table).not.toContain("Hidden.");
  });
});

describe("renderToolTable columns and order", () => {
  const tool = (name: string, risk: CliToolRow["risk"], needs: CliToolRow["needs"], summary: string) => ({
    name,
    risk,
    needs,
    summary,
    available: true,
  });

  test("pads each of the three first columns to its widest cell plus two spaces and leaves the summary unpadded", () => {
    expect(
      renderToolTable([
        tool("b", "outside", ["db", "imap"], "Second."),
        tool("long-name", "read", ["none"], "Third."),
        tool("a", "danger", ["llm"], "First."),
      ])
    ).toBe(
      [
        "a          danger   llm       First.",
        "b          outside  db, imap  Second.",
        "long-name  read     none      Third.",
        "",
      ].join("\n")
    );
  });

  test("sorts by name whatever the input order", () => {
    const names = (rows: readonly string[]) =>
      renderToolTable(rows.map((name) => tool(name, "read", ["db"], "S.")))
        .trimEnd()
        .split("\n")
        .map((line) => line.split(" ")[0]);
    expect(names(["c", "a", "b"])).toEqual(["a", "b", "c"]);
    expect(names(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(names(["b", "c", "a"])).toEqual(["a", "b", "c"]);
  });

  test("keeps the input order of two rows with the same name", () => {
    const lines = renderToolTable([tool("x", "read", ["db"], "One."), tool("x", "read", ["db"], "Two.")])
      .trimEnd()
      .split("\n");
    expect(lines).toEqual(["x  read  db  One.", "x  read  db  Two."]);
  });

  test("an unavailable row counts in the widths with its dashes and name", () => {
    expect(
      renderToolTable([
        tool("a", "read", ["db"], "One."),
        { ...tool("zzzz", "danger", ["vps"], "Hidden."), available: false },
      ])
    ).toBe(["a     read  db  One.", "zzzz  -     -   not in this install", ""].join("\n"));
  });

  test("a list with no rows prints an empty string", () => {
    expect(renderToolTable([])).toBe("");
  });
});

describe("UsageError", () => {
  test("is an Error with its own name", () => {
    const error = new UsageError("bad flag");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UsageError");
    expect(error.message).toBe("bad flag");
  });
});
