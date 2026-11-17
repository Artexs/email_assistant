import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { dataCategories, subprocessors } from "@ea/core";
import { describe, expect, test } from "bun:test";

// The internal papers of `docs/legal/` (ticket `spec/features/active/F107-e7-t4-papers-and-cost/`) must name every data category and every sub-processor with personal
// data, hold the headings of the DPIA and the breach procedure, and cite only paths that exist. A new table or an outside
// service then fails here until the papers name it.

const ROOT = path.resolve(import.meta.dir, "../../..");
const LEGAL_DIR = path.join(ROOT, "docs/legal");
// "spec/" is not checked: a ticket folder changes lane when the ticket moves (the capability map test does the same).
const PATH_ROOTS = ["apps/", "packages/", "db/", "deploy/", "docs/", "tools/", "scripts/", "evals/"];

const DPIA_HEADINGS = [
  "Description of the processing",
  "Necessity and proportionality",
  "Risks",
  "Measures",
  "Residual risk",
  "Decision",
] as const;
const BREACH_HEADINGS = [
  "Detect",
  "Contain",
  "Assess",
  "Notify the controller",
  "Notify the authority and the people",
  "Record",
  "After",
] as const;

/** Every backticked token of a text. */
function backticked(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

/** The ids that no backticked token of the text holds. */
function missingIds(ids: readonly string[], markdown: string): string[] {
  const found = new Set(backticked(markdown));
  return ids.filter((id) => !found.has(id));
}

/** The `##` headings of a text, in order. */
function headingsOf(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

/** Backticked tokens that start with a PATH_ROOT, without a line suffix or an anchor. Placeholders are skipped. */
function pathTokens(markdown: string): string[] {
  const tokens: string[] = [];
  for (const raw of backticked(markdown)) {
    if (/[\s<*{$]/.test(raw)) {
      continue;
    }
    const token = raw.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "");
    if (PATH_ROOTS.some((root) => token.startsWith(root))) {
      tokens.push(token);
    }
  }
  return tokens;
}

/** The `<…>` placeholders of a text, outside the backticked tokens that are repo paths. */
function placeholdersOf(markdown: string): string[] {
  const text = markdown.replace(/`([^`\n]+)`/g, (whole, raw: string) =>
    PATH_ROOTS.some((root) => raw.startsWith(root)) ? "" : whole
  );
  return [...text.matchAll(/<[^<>\n]+>/g)].map((match) => match[0]);
}

/** The table row of a category: the line that starts with the id in backticks as its first cell. */
function rowOf(id: string, markdown: string): string | undefined {
  return markdown.split("\n").find((line) => line.startsWith("|") && line.split("|")[1]?.trim() === `\`${id}\``);
}

const webLegal = readFileSync(path.join(ROOT, "apps/web/src/lib/legal.ts"), "utf8");
const allowedPlaceholders = new Set(
  /export const legalPlaceholders = \[([^\]]*)\]/
    .exec(webLegal)?.[1]
    ?.split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean) ?? []
);

function placeholderProblems(markdown: string): string[] {
  return placeholdersOf(markdown).filter(
    (placeholder) => !allowedPlaceholders.has(placeholder) && !/^<to confirm: [^<>\n]+>$/.test(placeholder)
  );
}

const papers = readdirSync(LEGAL_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();
const text = (name: string): string => readFileSync(path.join(LEGAL_DIR, name), "utf8");
const records = text("records-of-processing.md");

describe("legal papers helpers", () => {
  test("missingIds names an id that no backticked token holds", () => {
    expect(missingIds(["a", "b-c"], "`a` and b-c and `a b-c`")).toEqual(["b-c"]);
  });

  test("headingsOf keeps the ## lines in order and skips # and ###", () => {
    expect(headingsOf("# T\n\n## One\n\n### Sub\n\n## Two\n")).toEqual(["One", "Two"]);
  });

  test("pathTokens keeps repo paths, strips suffixes and skips placeholders and other roots", () => {
    expect(pathTokens("`apps/x.ts:3`, `docs/a.md#b`, `<to confirm: x>`, `bun run lint`, `spec/f/`, `deploy/`")).toEqual(
      ["apps/x.ts", "docs/a.md", "deploy/"]
    );
  });

  test("placeholdersOf skips the angle brackets of a repo path", () => {
    expect(placeholdersOf("`apps/web/src/legal/<lang>/<doc>.md` and `<contact>` and <x y>")).toEqual([
      "<contact>",
      "<x y>",
    ]);
  });

  test("placeholderProblems flags a placeholder outside the allowed list", () => {
    expect(placeholderProblems("`<contact>`, `<to confirm: a fact>`, `<breach register location>`")).toEqual([
      "<breach register location>",
    ]);
  });

  test("rowOf finds the row of an id and not a row that only mentions it", () => {
    expect(rowOf("a", "| `a` | x |\n| `b` | `a` |")).toBe("| `a` | x |");
    expect(rowOf("c", "| `a` | `c` |")).toBeUndefined();
  });

  test("the allowed placeholder list is read from apps/web/src/lib/legal.ts", () => {
    expect(allowedPlaceholders.has("<provider name>")).toBe(true);
    expect(allowedPlaceholders.size).toBeGreaterThanOrEqual(5);
  });
});

describe("docs/legal", () => {
  test("1. every data category id is in backticks in the records of processing", () => {
    expect(
      missingIds(
        dataCategories.map((category) => category.id),
        records
      )
    ).toEqual([]);
  });

  test("1b. the row of each category names its tables and its day count", () => {
    for (const category of dataCategories) {
      const row = rowOf(category.id, records);
      expect({ id: category.id, row: row !== undefined }).toEqual({ id: category.id, row: true });
      const tables = [...new Set(category.columns.map((entry) => entry.slice(0, entry.indexOf("."))))];
      expect({ id: category.id, missing: missingIds(tables, row ?? "") }).toEqual({ id: category.id, missing: [] });
      const kept = category.kept;
      if (kept.kind !== "untilDelete") {
        const days = kept.kind === "orgSetting" ? kept.defaultDays : kept.days;
        expect({ id: category.id, days: new RegExp(`\\b${days} days?\\b`).test(row ?? "") }).toEqual({
          id: category.id,
          days: true,
        });
      }
    }
  });

  test("2. every sub-processor id with personal data is in backticks in the records of processing", () => {
    const ids = subprocessors.filter((service) => service.personalData).map((service) => service.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(missingIds(ids, records)).toEqual([]);
  });

  test("3. dpia.md and breach-procedure.md hold their ## headings, in order", () => {
    expect(headingsOf(text("dpia.md"))).toEqual([...DPIA_HEADINGS]);
    expect(headingsOf(text("breach-procedure.md"))).toEqual([...BREACH_HEADINGS]);
  });

  test("4. every repo path in backticks exists", () => {
    expect(papers).toEqual(["README.md", "breach-procedure.md", "dpia.md", "records-of-processing.md"]);
    for (const file of papers) {
      for (const token of pathTokens(text(file))) {
        const exists = existsSync(path.join(ROOT, token));
        expect({ file, token, exists }).toEqual({ file, token, exists: true });
      }
    }
  });

  test("5. every placeholder is on the allowed list or is a <to confirm: …>", () => {
    for (const file of papers) {
      expect({ file, bad: placeholderProblems(text(file)) }).toEqual({ file, bad: [] });
    }
  });

  test("6. the dpia holds the eight required risks, each with a level", () => {
    const dpia = text("dpia.md");
    for (let index = 1; index <= 8; index += 1) {
      const row = dpia.split("\n").find((line) => line.split("|")[1]?.trim() === `R${index}`);
      expect({ risk: index, row: row !== undefined }).toEqual({ risk: index, row: true });
      expect({ risk: index, levels: /\|\s*(low|medium|high)\s*\|\s*(low|medium|high)\s*\|$/.test(row ?? "") }).toEqual({
        risk: index,
        levels: true,
      });
    }
  });
});
