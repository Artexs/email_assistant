import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { bodyHash, frontMatterValue } from "../scripts/stale";
import { POLISH_SET, SOURCE_HASH_SHAPE } from "./front-matter";
import { isShotPage } from "./shots";

const CONTENT_DIR = join(import.meta.dir, "content/docs");

// The file of a page id in a folder: `x.mdx`, or `x/index.mdx` for a folder page such as `start`.
function pageFile(dir: string, id: string): string | null {
  for (const candidate of [`${id}.mdx`, `${id}/index.mdx`]) {
    if (existsSync(join(dir, candidate))) return join(dir, candidate);
  }
  return null;
}

// The text outside code fences: a fence may hold lines that look like headings or steps.
function outsideCode(markdown: string): string[] {
  let inFence = false;
  return markdown.split("\n").filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return false;
    }
    return !inFence;
  });
}

// The `<Shot page="x" />` lines outside code fences, in page order. `underHeading`: the line before is a ## or ### heading;
// `blankAfter`: the line after is blank. Both hold on a page, so that `bodyHash` (which cuts the line alone) leaves the hash of the page as it was.
export interface ShotLine {
  page: string;
  line: number;
  underHeading: boolean;
  blankAfter: boolean;
}
export function shotLines(markdown: string): ShotLine[] {
  const lines = outsideCode(markdown);
  return lines.flatMap((text, line) => {
    const match = /^<Shot page="([^"]*)" \/>$/.exec(text);
    if (!match) return [];
    return [
      {
        page: match[1] ?? "",
        line,
        underHeading: /^#{2,3} /.test(lines[line - 1] ?? ""),
        blankAfter: (lines[line + 1] ?? "") === "",
      },
    ];
  });
}

// The number of Shot lines of each section: the text before the first heading, then each ## or ### heading with its text.
export function shotsPerSection(markdown: string): number[] {
  const counts = [0];
  for (const text of outsideCode(markdown)) {
    if (/^#{2,3} /.test(text)) counts.push(0);
    else if (/^<Shot\b/.test(text)) counts[counts.length - 1] = (counts.at(-1) ?? 0) + 1;
  }
  return counts;
}

// Everything the two pages of a pair must share: sections, steps, panel labels, links, shots, capabilities.
function structure(markdown: string) {
  const lines = outsideCode(markdown);
  const text = lines.join("\n");
  return {
    h2: lines.filter((line) => /^## /.test(line)).length,
    h3: lines.filter((line) => /^### /.test(line)).length,
    steps: lines.filter((line) => /^\s*\d+\. /.test(line)).length,
    // The panel keys in page order: the Polish page gets the Polish text by itself, so the keys must match.
    uiKeys: [...text.matchAll(/<UiText\s+k="([^"]+)"/g)].map((match) => match[1]),
    // The link targets in page order. A target is relative to the page folder; the pair has the same folder depth.
    links: [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]),
    // The `<Shot page />` values in page order: both languages show the same panel pages in the same sections.
    shots: shotLines(markdown).map((shot) => shot.page),
  };
}

// `<rule> <english> <polish>` lines for each difference; an empty list means the pair has the same shape.
export function pairProblems(english: string, polish: string): string[] {
  const en = structure(english);
  const pl = structure(polish);
  const problems: string[] = [];
  if (en.h2 !== pl.h2) problems.push(`h2 ${en.h2} ${pl.h2}`);
  if (en.h3 !== pl.h3) problems.push(`h3 ${en.h3} ${pl.h3}`);
  if (en.steps !== pl.steps) problems.push(`steps ${en.steps} ${pl.steps}`);
  if (en.uiKeys.join(",") !== pl.uiKeys.join(","))
    problems.push(`ui_keys ${en.uiKeys.join(",")} ${pl.uiKeys.join(",")}`);
  if (en.links.join(",") !== pl.links.join(",")) problems.push(`links ${en.links.join(",")} ${pl.links.join(",")}`);
  if (en.shots.join(",") !== pl.shots.join(",")) problems.push(`shots ${en.shots.join(",")} ${pl.shots.join(",")}`);
  return problems;
}

function mdxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return mdxFiles(path);
    return name.endsWith(".mdx") ? [path] : [];
  });
}

const PAGE =
  '---\ntitle: T\n---\nIntro [a](../a/)\n\n## One\n\n1. Press <UiText k="save" />.\n2. Go.\n\n### Sub\n\n## Two\n';

describe("Polish pages", () => {
  test("T4 each pair has the same ## and ### headings, numbered steps, panel keys, links and Shot lines", () => {
    for (const id of POLISH_SET) {
      const english = pageFile(CONTENT_DIR, id);
      const polish = pageFile(join(CONTENT_DIR, "pl"), id);
      expect({ id, english: english !== null, polish: polish !== null }).toEqual({ id, english: true, polish: true });
      const problems = pairProblems(readFileSync(english ?? "", "utf8"), readFileSync(polish ?? "", "utf8"));
      expect({ id, problems }).toEqual({ id, problems: [] });
    }
  });
  test("T2 the Polish pages are exactly the pages of POLISH_SET", () => {
    const ids = mdxFiles(join(CONTENT_DIR, "pl")).map((file) =>
      relative(join(CONTENT_DIR, "pl"), file)
        .replace(/\.mdx$/, "")
        .replace(/(?<=.)\/index$/, "")
    );
    expect(ids.sort()).toEqual([...POLISH_SET].sort());
  });
  test("every English how-to page is in POLISH_SET (plan P6)", () => {
    const howTo = readdirSync(join(CONTENT_DIR, "how-to"))
      .filter((name) => name.endsWith(".mdx"))
      .map((name) => `how-to/${name.replace(/\.mdx$/, "")}`);
    for (const id of howTo) expect(POLISH_SET).toContain(id);
  });
  test("each Polish page names its English page as `source` and the same capabilities", () => {
    for (const id of POLISH_SET) {
      const english = readFileSync(pageFile(CONTENT_DIR, id) ?? "", "utf8");
      const polish = readFileSync(pageFile(join(CONTENT_DIR, "pl"), id) ?? "", "utf8");
      expect({ id, source: frontMatterValue(polish, "source") }).toEqual({ id, source: id });
      const capabilities = (text: string) => /^capabilities:\n((?: {2}- .+\n)+)/m.exec(text)?.[1] ?? "";
      expect({ id, capabilities: capabilities(polish) }).toEqual({ id, capabilities: capabilities(english) });
    }
  });
  test("the Polish security and pricing pages have `source`, a 16-hex `sourceHash` that matches the English body, and the pair shape", () => {
    for (const id of ["security", "pricing"]) {
      const english = readFileSync(pageFile(CONTENT_DIR, id) ?? "", "utf8");
      const polish = readFileSync(pageFile(join(CONTENT_DIR, "pl"), id) ?? "", "utf8");
      expect({ id, source: frontMatterValue(polish, "source") }).toEqual({ id, source: id });
      const hash = frontMatterValue(polish, "sourceHash") ?? "";
      expect({ id, shape: SOURCE_HASH_SHAPE.test(hash) }).toEqual({ id, shape: true });
      expect({ id, current: hash === bodyHash(english) }).toEqual({ id, current: true });
      expect({ id, problems: pairProblems(english, polish) }).toEqual({ id, problems: [] });
    }
  });
  test("the Polish security and pricing pages hold no Gemini text at all (a mention would need its condition: optional, off by default)", () => {
    for (const id of ["security", "pricing"]) {
      const text = readFileSync(pageFile(join(CONTENT_DIR, "pl"), id) ?? "", "utf8");
      expect({ id, gemini: /gemini/i.test(text) }).toEqual({ id, gemini: false });
    }
  });
  test("each rule of the pair check finds its difference", () => {
    expect(pairProblems(PAGE, PAGE)).toEqual([]);
    expect(pairProblems(PAGE, PAGE.replace("## Two\n", ""))).toEqual(["h2 2 1"]);
    expect(pairProblems(PAGE, PAGE.replace("### Sub\n", ""))).toEqual(["h3 1 0"]);
    expect(pairProblems(PAGE, PAGE.replace("2. Go.\n", ""))).toEqual(["steps 2 1"]);
    expect(pairProblems(PAGE, PAGE.replace('k="save"', 'k="cancel"'))).toEqual(["ui_keys save cancel"]);
    expect(pairProblems(PAGE, PAGE.replace('<UiText k="save" />', "Zapisz"))).toEqual(["ui_keys save "]);
    expect(pairProblems(PAGE, PAGE.replace("(../a/)", "(../b/)"))).toEqual(["links ../a/ ../b/"]);
    const shot = (page: string) => PAGE.replace("## One\n", `## One\n<Shot page="${page}" />\n`);
    expect(pairProblems(shot("rules"), shot("rules"))).toEqual([]);
    expect(pairProblems(shot("rules"), PAGE)).toEqual(["shots rules "]);
    expect(pairProblems(PAGE, shot("rules"))).toEqual(["shots  rules"]);
    expect(pairProblems(shot("rules"), shot("settings"))).toEqual(["shots rules settings"]);
    const two = PAGE.replace("## One\n", '## One\n<Shot page="rules" />\n').replace(
      "## Two\n",
      '## Two\n<Shot page="settings" />\n'
    );
    const swapped = two.replace("rules", "tmp").replace("settings", "rules").replace("tmp", "settings");
    expect(pairProblems(two, swapped)).toEqual(["shots rules,settings settings,rules"]);
  });
  test("each `<Shot page>` of a page is a page of SHOTS, and a page has a Shot line only with the import of the component", () => {
    for (const file of mdxFiles(CONTENT_DIR)) {
      const text = readFileSync(file, "utf8");
      const id = relative(CONTENT_DIR, file);
      const pages = shotLines(text).map((shot) => shot.page);
      for (const page of pages) expect({ id, page, known: isShotPage(page) }).toEqual({ id, page, known: true });
      // The import line sits next to the `UiText` import of the page and has its path.
      const uiImport = /^import UiText from "((?:\.\.\/)+)components\/UiText\.astro";$/m.exec(text);
      const shotImport = /^import Shot from "((?:\.\.\/)+)components\/Shot\.astro";$/gm;
      const imports = [...text.matchAll(shotImport)];
      expect({ id, imports: imports.length, pages: pages.length > 0 }).toEqual({
        id,
        imports: pages.length > 0 ? 1 : 0,
        pages: pages.length > 0,
      });
      if (pages.length > 0) expect({ id, path: imports[0]?.[1] ?? null }).toEqual({ id, path: uiImport?.[1] ?? "" });
    }
  });
  test("at most one Shot line a section, directly under its heading and before a blank line (the hash of the page stays)", () => {
    for (const file of mdxFiles(CONTENT_DIR)) {
      const id = relative(CONTENT_DIR, file);
      const text = readFileSync(file, "utf8");
      const shots = shotLines(text);
      for (const shot of shots) {
        expect({ id, page: shot.page, underHeading: shot.underHeading, blankAfter: shot.blankAfter }).toEqual({
          id,
          page: shot.page,
          underHeading: true,
          blankAfter: true,
        });
      }
      expect({ id, perSection: shotsPerSection(text).filter((count) => count > 1) }).toEqual({ id, perSection: [] });
    }
  });
  test("the tutorial shows each of the five panel pages once, and the sender-rule and digest-time guides show theirs", () => {
    const pagesOf = (dir: string, id: string) =>
      shotLines(readFileSync(pageFile(dir, id) ?? "", "utf8")).map((shot) => shot.page);
    for (const dir of [CONTENT_DIR, join(CONTENT_DIR, "pl")]) {
      expect(pagesOf(dir, "start")).toEqual(["onboarding", "mailboxes", "rules", "activity", "settings"]);
      expect(pagesOf(dir, "how-to/sender-rules")).toEqual(["rules"]);
      expect(pagesOf(dir, "how-to/digest-times")).toEqual(["settings"]);
    }
  });
  test("the Shot lines of a page are cut whole by the pair check: a line of a section with two lines, or one not under a heading, is found", () => {
    const heading = shotLines('## A\n<Shot page="rules" />\n\ntext\n');
    expect(heading).toEqual([{ page: "rules", line: 1, underHeading: true, blankAfter: true }]);
    expect(shotLines('## A\n\n<Shot page="rules" />\n\ntext\n')[0]?.underHeading).toBe(false);
    expect(shotLines('## A\n<Shot page="rules" />\ntext\n')[0]?.blankAfter).toBe(false);
    expect(shotLines('```\n<Shot page="rules" />\n```\n')).toEqual([]);
    expect(shotLines('## A\n<Shot page="rules"/>\n')).toEqual([]);
    expect(shotsPerSection('## A\n<Shot page="rules" />\n\n## B\n<Shot page="rules" />\n')).toEqual([0, 1, 1]);
    expect(shotsPerSection('## A\n<Shot page="rules" />\n\n<Shot page="settings" />\n')).toEqual([0, 2]);
  });
  test("a heading or a step inside a code fence does not count", () => {
    const fenced = `${PAGE}\n\`\`\`\n## Not a heading\n1. Not a step\n\`\`\`\n`;
    expect(pairProblems(PAGE, fenced)).toEqual([]);
  });
});
