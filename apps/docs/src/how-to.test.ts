import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOW_TO_DIR = join(import.meta.dir, "content/docs/how-to");
// A how-to page is short (the plan says about 50 lines).
const MAX_LINES = 60;
// A CLI command appears only as "your operator runs ..." and the operator pages hold the detail.
const CLI_COMMAND = /\bbun run\b|\$C run\b|\bdocker compose\b/;

// The rules of a how-to page, as a list of `<rule> <line>` problems. An empty list means the page is fine.
function howToProblems(source: string): string[] {
  const lines = source.split("\n");
  const problems: string[] = [];
  if (lines.length > MAX_LINES) problems.push(`too_long ${lines.length}`);
  lines.forEach((line, index) => {
    if (CLI_COMMAND.test(line)) problems.push(`cli_command ${index + 1}`);
  });
  if (!lines.some((line) => /^1\. /.test(line))) problems.push("no_numbered_steps");
  if (!lines.some((line) => line.trim() === "## What happens next")) problems.push("no_what_happens_next");
  return problems;
}

const PAGES = readdirSync(HOW_TO_DIR)
  .filter((name) => name.endsWith(".mdx"))
  .sort();

describe("how-to pages", () => {
  test.each(PAGES)("%s follows the rules of a how-to page", (name) => {
    expect({ name, problems: howToProblems(readFileSync(join(HOW_TO_DIR, name), "utf8")) }).toEqual({
      name,
      problems: [],
    });
  });
  test("each rule finds its problem", () => {
    expect(MAX_LINES).toBe(60);
    const good = "1. Do it.\n\n## What happens next\n\nDone.\n";
    expect(howToProblems(good)).toEqual([]);
    expect(howToProblems(`${good}Run bun run x.\n`)).toEqual(["cli_command 6"]);
    expect(howToProblems(`${good}$C run --rm cli x\n`)).toEqual(["cli_command 6"]);
    expect(howToProblems(`${good}docker compose up\n`)).toEqual(["cli_command 6"]);
    expect(howToProblems(`${good}${"line\n".repeat(MAX_LINES)}`)).toEqual([`too_long ${MAX_LINES + 6}`]);
    expect(howToProblems("Do it.\n\n## What happens next\n")).toEqual(["no_numbered_steps"]);
    expect(howToProblems("1. Do it.\n")).toEqual(["no_what_happens_next"]);
  });
});
