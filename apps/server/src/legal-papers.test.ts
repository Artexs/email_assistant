import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { dataCategories, subprocessors } from "@ea/core";
import { describe, expect, test } from "bun:test";

// The internal papers of `docs/legal/` must name every data category and every sub-processor with personal
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
const claims = text("claims.md");

interface ClaimRow {
  id: string;
  claim: string;
  source: string;
  condition: string;
}

/** The rows of the claims list: the table lines whose first cell is `C` and three digits. */
function claimRows(markdown: string): ClaimRow[] {
  return markdown
    .split("\n")
    .filter((line) => /^\| C\d{3} \|/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return { id: cells[0] ?? "", claim: cells[1] ?? "", source: cells[2] ?? "", condition: cells[3] ?? "" };
    });
}

/** The ADR numbers (`ADR 0015`) of a source cell. */
function adrNumbers(source: string): string[] {
  return [...source.matchAll(/\bADR (\d{4})\b/g)].map((match) => match[1] ?? "");
}

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

  test("claimRows reads the table rows and adrNumbers reads the ADR numbers of a source", () => {
    const rows = claimRows("| # | Claim |\n| C001 | a claim | `docs/a.md`, ADR 0015 | — |\n| C002 | b | s | c |");
    expect(rows).toEqual([
      { id: "C001", claim: "a claim", source: "`docs/a.md`, ADR 0015", condition: "—" },
      { id: "C002", claim: "b", source: "s", condition: "c" },
    ]);
    expect(adrNumbers("ADR 0015 and ADR 0009; ADR 12")).toEqual(["0015", "0009"]);
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

  test("2b. the Recipients row of each record names the right sub-processors", () => {
    const section = (heading: string): string => {
      const start = records.indexOf(heading);
      const next = records.indexOf("\n## ", start + 1);
      return records.slice(start, next === -1 ? undefined : next);
    };
    const recipientsOf = (markdown: string): string[] => {
      const row = markdown.split("\n").find((line) => /^\| Recipients\b/.test(line)) ?? "";
      // The ids before "Services that get no personal data" are the recipients with personal data.
      const head = row.split("Services that get no personal data")[0] ?? "";
      const known = new Set(subprocessors.map((service) => service.id));
      return backticked(head).filter((token) => known.has(token));
    };
    // Record A (provider as controller): the services that get the data of members. Record B (provider as processor): every service with personal data.
    expect(recipientsOf(section("## Record A")).sort()).toEqual(["auth-smtp", "tailscale", "telegram", "web-push"]);
    const withData = subprocessors.filter((service) => service.personalData).map((service) => service.id);
    expect(recipientsOf(section("## Record B")).sort()).toEqual([...withData].sort());
  });

  test("3. dpia.md and breach-procedure.md hold their ## headings, in order", () => {
    expect(headingsOf(text("dpia.md"))).toEqual([...DPIA_HEADINGS]);
    expect(headingsOf(text("breach-procedure.md"))).toEqual([...BREACH_HEADINGS]);
  });

  test("4. every repo path in backticks exists", () => {
    expect(papers).toEqual(["README.md", "breach-procedure.md", "claims.md", "dpia.md", "records-of-processing.md"]);
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

describe("docs/legal/claims.md", () => {
  const rows = claimRows(claims);

  test("5. every row has a claim, a source and a condition; ids are C001, C002, … in order, with no gap", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.id)).toEqual(rows.map((_, index) => `C${String(index + 1).padStart(3, "0")}`));
    for (const row of rows) {
      expect({ id: row.id, claim: row.claim.length > 0 }).toEqual({ id: row.id, claim: true });
      expect({ id: row.id, source: row.source.length > 0 }).toEqual({ id: row.id, source: true });
      expect({ id: row.id, condition: row.condition.length > 0 }).toEqual({ id: row.id, condition: true });
    }
  });

  test("5. every repo path in the Source column exists", () => {
    for (const row of rows) {
      for (const token of pathTokens(row.source)) {
        const exists = existsSync(path.join(ROOT, token));
        expect({ id: row.id, token, exists }).toEqual({ id: row.id, token, exists: true });
      }
    }
  });

  test("6. every ADR number in the Source column is a file in docs/decisions", () => {
    const files = readdirSync(path.join(ROOT, "docs/decisions"));
    for (const row of rows) {
      for (const number of adrNumbers(row.source)) {
        const found = files.some((file) => file.startsWith(`${number}-`) && file.endsWith(".md"));
        expect({ id: row.id, adr: number, found }).toEqual({ id: row.id, adr: number, found: true });
      }
    }
  });

  test("each public URL in the Source column is followed by the date it was read", () => {
    for (const row of rows) {
      const urls = [...row.source.matchAll(/https?:\/\/[^\s),;]+/g)];
      for (const [index, url] of urls.entries()) {
        const from = (url.index ?? 0) + url[0].length;
        const to = urls[index + 1]?.index ?? row.source.length;
        const dated = /read \d{4}-\d{2}-\d{2}/.test(row.source.slice(from, to));
        expect({ id: row.id, url: url[0], dated }).toEqual({ id: row.id, url: url[0], dated: true });
      }
    }
  });

  test("the counts at the top match the rows: the total, and each paper", () => {
    const total = /\| Total\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|\s+(\d+)\s+\|/.exec(claims);
    expect(Number(total?.[1])).toBe(rows.length);
    expect(Number(total?.[2])).toBe(rows.filter((row) => row.source.startsWith("gap")).length);
    expect(Number(total?.[3])).toBe(rows.filter((row) => row.source.includes("unverified")).length);
  });

  test("each sub-processor id of the registry has a row that starts with `Row` and its id", () => {
    for (const service of subprocessors) {
      const has = rows.some((row) => row.claim.startsWith(`Row \`${service.id}\`:`));
      expect({ id: service.id, has }).toEqual({ id: service.id, has: true });
    }
  });

  test("each termsUrl of the sub-processor registry is named in a row of its own service", () => {
    for (const service of subprocessors.filter((entry) => entry.termsUrl.startsWith("http"))) {
      const named = rows.some(
        (row) => row.claim.startsWith(`Row \`${service.id}\`:`) && row.claim.includes(service.termsUrl)
      );
      expect({ id: service.id, url: service.termsUrl, named }).toEqual({
        id: service.id,
        url: service.termsUrl,
        named: true,
      });
    }
  });
});
