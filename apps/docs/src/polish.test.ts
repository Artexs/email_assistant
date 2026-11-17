import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { frontMatterValue } from "../scripts/stale";
import { POLISH_SET } from "./front-matter";

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

// Everything the two pages of a pair must share (stage 10 T4): sections, steps, panel labels, links, capabilities.
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
  test("T4 each pair has the same ## and ### headings, numbered steps, panel keys and links", () => {
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
  test("each rule of the pair check finds its difference", () => {
    expect(pairProblems(PAGE, PAGE)).toEqual([]);
    expect(pairProblems(PAGE, PAGE.replace("## Two\n", ""))).toEqual(["h2 2 1"]);
    expect(pairProblems(PAGE, PAGE.replace("### Sub\n", ""))).toEqual(["h3 1 0"]);
    expect(pairProblems(PAGE, PAGE.replace("2. Go.\n", ""))).toEqual(["steps 2 1"]);
    expect(pairProblems(PAGE, PAGE.replace('k="save"', 'k="cancel"'))).toEqual(["ui_keys save cancel"]);
    expect(pairProblems(PAGE, PAGE.replace('<UiText k="save" />', "Zapisz"))).toEqual(["ui_keys save "]);
    expect(pairProblems(PAGE, PAGE.replace("(../a/)", "(../b/)"))).toEqual(["links ../a/ ../b/"]);
  });
  test("a heading or a step inside a code fence does not count", () => {
    const fenced = `${PAGE}\n\`\`\`\n## Not a heading\n1. Not a step\n\`\`\`\n`;
    expect(pairProblems(PAGE, fenced)).toEqual([]);
  });
});
