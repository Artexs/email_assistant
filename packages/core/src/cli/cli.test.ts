import { describe, expect, test } from "bun:test";

import { type CliDescription, cliDescriptionSchema, renderHelp, renderToolTable, UsageError } from "./index";

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

describe("UsageError", () => {
  test("is an Error with its own name", () => {
    const error = new UsageError("bad flag");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UsageError");
    expect(error.message).toBe("bad flag");
  });
});
