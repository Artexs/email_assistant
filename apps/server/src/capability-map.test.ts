import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "../../..");
const CAP_DIR = path.join(ROOT, "docs/capabilities");
const SECTIONS = ["What it does now", "Rules", "Entry points", "Data", "Limits", "Decisions", "Tests"] as const;
// "spec/" is not checked: a ticket folder changes lane when the ticket moves.
const PATH_ROOTS = ["apps/", "packages/", "db/", "deploy/", "docs/", "tools/", "scripts/", "evals/"];
const CHECKED_LINE = /^> Checked against the code at `[0-9a-f]{7,40}`, \d{4}-\d{2}-\d{2}\.$/m;

/** Backticked tokens that start with a PATH_ROOT, without a line suffix or an anchor. Placeholders are skipped. */
function pathTokens(markdown: string): string[] {
  const tokens: string[] = [];
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1] ?? "";
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

function scriptNames(markdown: string): string[] {
  return [...markdown.matchAll(/bun run ([a-z0-9][a-z0-9:_-]*)/g)].map((match) => match[1] ?? "");
}

function adrNumbers(markdown: string): string[] {
  return [...markdown.matchAll(/ADR (\d{4})/g)].map((match) => match[1] ?? "");
}

/** File names of the rows `| [x.md](x.md) |` in the "## Pages" table. */
function indexPages(readme: string): string[] {
  const start = `\n${readme}`.indexOf("\n## Pages\n");
  if (start === -1) {
    return [];
  }
  const rest = readme.slice(start).split("\n");
  const pages: string[] = [];
  for (const line of rest.slice(1)) {
    if (line.startsWith("## ")) {
      break;
    }
    const match = /^\| \[([^\]]+)\]\(([^)]+)\) \|/.exec(line);
    if (match?.[2]) {
      pages.push(match[2]);
    }
  }
  return pages;
}

function pageProblems(markdown: string): string[] {
  const problems: string[] = [];
  if (!/^# \S/m.test(markdown)) {
    problems.push("no H1");
  }
  if (!CHECKED_LINE.test(markdown)) {
    problems.push("no checked line");
  }
  const found = markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
  if (found.join("|") !== SECTIONS.join("|")) {
    problems.push(`sections: ${found.join(", ")}`);
  }
  return problems;
}

function goodPage(sections: readonly string[] = SECTIONS): string {
  const head = "# Sync\n\n> Checked against the code at `9d9bfb8`, 2026-11-14.\n\n";
  return head + sections.map((name) => `## ${name}\n\ntext\n`).join("\n");
}

const readme = readFileSync(path.join(CAP_DIR, "README.md"), "utf8");
const pageFiles = readdirSync(CAP_DIR)
  .filter((name) => name !== "README.md")
  .sort();
const scripts = new Set(
  Object.keys((JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: object }).scripts)
);
const adrFiles = readdirSync(path.join(ROOT, "docs/decisions"));

describe("capability map helpers", () => {
  test("pathTokens keeps repo paths and strips line suffixes and anchors", () => {
    expect(
      pathTokens("see `apps/server/src/main.ts:85`, `docs/x.md#a`, `apps/<m>/`, `bun run lint`, `deploy/`")
    ).toEqual(["apps/server/src/main.ts", "docs/x.md", "deploy/"]);
  });

  test("pathTokens skips spec/ paths and line ranges", () => {
    expect(pathTokens("`apps/server/src/retention.ts:19-94`, `spec/features/planned/F029-x/`")).toEqual([
      "apps/server/src/retention.ts",
    ]);
  });

  test("scriptNames reads names after bun run", () => {
    expect(scriptNames("run `bun run org:flag --org-id x` or bun run lint; bun run --filter x")).toEqual([
      "org:flag",
      "lint",
    ]);
  });

  test("adrNumbers needs four digits", () => {
    expect(adrNumbers("ADR 0014 and ADR 0027, not ADR 14")).toEqual(["0014", "0027"]);
  });

  test("indexPages reads the Pages table", () => {
    expect(
      indexPages(
        "## Pages\n\n| Page | Capability | Main modules |\n| --- | --- | --- |\n| [sync.md](sync.md) | Sync | mail |\n"
      )
    ).toEqual(["sync.md"]);
  });

  test("pageProblems accepts a good page", () => {
    expect(pageProblems(goodPage())).toEqual([]);
  });

  test("pageProblems flags a missing section", () => {
    const problems = pageProblems(goodPage(SECTIONS.filter((name) => name !== "Limits")));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.startsWith("sections:")).toBe(true);
  });

  test("pageProblems flags sections out of order", () => {
    const swapped: string[] = [...SECTIONS];
    [swapped[1], swapped[3]] = [swapped[3] as string, swapped[1] as string];
    const problems = pageProblems(goodPage(swapped));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.startsWith("sections:")).toBe(true);
  });

  test("pageProblems flags a short sha", () => {
    expect(pageProblems(goodPage().replace("`9d9bfb8`", "`abc`"))).toEqual(["no checked line"]);
  });
});

describe("docs/capabilities", () => {
  test("the index lists every page file and no other", () => {
    expect(existsSync(path.join(ROOT, "package.json"))).toBe(true);
    expect([...indexPages(readme)].sort()).toEqual(pageFiles);
  });

  test("every page has the H1, the checked line and the seven sections", () => {
    for (const page of pageFiles) {
      const problems = pageProblems(readFileSync(path.join(CAP_DIR, page), "utf8"));
      expect({ page, problems }).toEqual({ page, problems: [] });
    }
  });

  test("every path, script and ADR number in a page and the README exists", () => {
    for (const file of ["README.md", ...pageFiles]) {
      const markdown = readFileSync(path.join(CAP_DIR, file), "utf8");
      for (const token of pathTokens(markdown)) {
        const exists = existsSync(path.join(ROOT, token));
        expect({ file, token, exists }).toEqual({ file, token, exists: true });
      }
      for (const script of scriptNames(markdown)) {
        const exists = scripts.has(script);
        expect({ file, script, exists }).toEqual({ file, script, exists: true });
      }
      for (const adr of adrNumbers(markdown)) {
        const exists = adrFiles.filter((name) => name.startsWith(`${adr}-`) && name.endsWith(".md")).length === 1;
        expect({ file, adr, exists }).toEqual({ file, adr, exists: true });
      }
    }
  });
});
