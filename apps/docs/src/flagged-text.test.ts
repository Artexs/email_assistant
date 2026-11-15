import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { featureFlags, featureKeys } from "@ea/core";
import { en } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

import {
  expandUiText,
  FLAGGED_BOT_TEXT,
  FLAGGED_PANEL_KEYS,
  FLAGGED_TEXT,
  flaggedTextProblems,
  literalParts,
  NO_VISIBLE_TEXT,
} from "./flagged-text";

const CONTENT_DIR = join(import.meta.dir, "content/docs");
const CORE_TEXT_DIRS = ["texts", "digest"].map((name) => join(import.meta.dir, "../../../packages/core/src", name));

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return /\.mdx?$/.test(name) ? [path] : [];
  });
}

const defaultOff = featureKeys.filter((key) => featureFlags[key].default === false);

describe("flagged text list", () => {
  test("T2 each default-off flag has flagged text, or a reason why no text exists yet; never both", () => {
    const withText = new Set(FLAGGED_TEXT.map((entry) => entry.flag));
    for (const flag of defaultOff) {
      const hasText = withText.has(flag);
      const hasReason = Object.hasOwn(NO_VISIBLE_TEXT, flag);
      expect({ flag, covered: hasText !== hasReason }).toEqual({ flag, covered: true });
    }
  });
  test("T2 every flag named in the list stands in the registry", () => {
    for (const flag of [
      ...Object.keys(FLAGGED_PANEL_KEYS),
      ...Object.keys(FLAGGED_BOT_TEXT),
      ...Object.keys(NO_VISIBLE_TEXT),
    ]) {
      expect(featureKeys as string[]).toContain(flag);
    }
    expect(new Set(FLAGGED_TEXT.map((entry) => entry.flag)).size).toBeGreaterThanOrEqual(18);
  });
  test("T2 each panel key gives an English and a Polish entry, and no entry is empty", () => {
    for (const [flag, keys] of Object.entries(FLAGGED_PANEL_KEYS)) {
      for (const key of keys ?? []) {
        expect(FLAGGED_TEXT).toContainEqual({ flag, text: en[key] });
        expect(FLAGGED_TEXT).toContainEqual({ flag, text: pl[key] });
      }
    }
    for (const entry of FLAGGED_TEXT) expect(entry.text.trim()).not.toBe("");
  });
  test("T2 each entry has a part that the scan can find", () => {
    for (const entry of FLAGGED_TEXT)
      expect({ entry, parts: literalParts(entry.text).length > 0 }).toEqual({ entry, parts: true });
  });
  test("T2 each Telegram literal still stands in packages/core/src/texts or digest", () => {
    const source = CORE_TEXT_DIRS.flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => readFileSync(join(dir, name), "utf8"))
    ).join("\n");
    for (const [flag, texts] of Object.entries(FLAGGED_BOT_TEXT)) {
      for (const text of texts ?? [])
        expect({ flag, text, found: source.includes(text) }).toEqual({ flag, text, found: true });
    }
  });
  test("T2 a literal holds no quote or backslash that a source file would escape", () => {
    for (const texts of Object.values(FLAGGED_BOT_TEXT))
      for (const text of texts ?? []) expect(text).not.toMatch(/["'\\]/);
  });
});

describe("flaggedTextProblems", () => {
  test("a page that holds a flagged string fails with the flag and the text", () => {
    expect(flaggedTextProblems("Turn on **Track my sent mail** in Settings.")).toContainEqual(
      `sent_sync: ${en.sent_switch}`
    );
  });
  test("the match ignores case, Markdown marks and line breaks", () => {
    expect(flaggedTextProblems("Use `/REVIEW` now.")).toContainEqual("review_command: /review");
    expect(flaggedTextProblems("Track my\nsent   mail")).not.toEqual([]);
    expect(flaggedTextProblems("Track `my` sent mail")).not.toEqual([]);
  });
  test("a Polish string and an emoji-only entry fail too", () => {
    expect(flaggedTextProblems(pl.sent_switch)).toContainEqual(`sent_sync: ${pl.sent_switch}`);
    expect(flaggedTextProblems("The line starts with 📎 and a number.")).toContainEqual("attachment_line: 📎");
  });
  test("a panel key that a page renders with `<UiText k />` counts as its text", () => {
    expect(expandUiText('A <UiText k="dgn_remind" /> button.')).toContain(en.dgn_remind);
    expect(flaggedTextProblems('Press <UiText k="dgn_remind" />.')).toContainEqual(
      `delegation_pages: ${en.dgn_remind}`
    );
    expect(flaggedTextProblems("Press <UiText k='dgn_remind' />.")).not.toEqual([]);
  });
  test("a text with a placeholder is found by its fixed part", () => {
    expect(literalParts("Follow-up {n} of 2")).toEqual(["follow-up"]);
    expect(flaggedTextProblems("📝 Follow-up wait")).toContainEqual("open_loops: 📝 Follow-up");
  });
  test("a flag that defaults on is not flagged; a clean page has no problem", () => {
    expect(flaggedTextProblems("Track my sent mail", FLAGGED_TEXT, (flag) => flag === "sent_sync")).toEqual([]);
    expect(flaggedTextProblems("Press the Pause button on the Mailboxes page.")).toEqual([]);
  });
  test("a short word that is a part of a longer panel text is not flagged on its own", () => {
    expect(flaggedTextProblems("Stats and delegations are words in plain prose.")).toEqual([]);
  });
});

describe("the pages of the docs site", () => {
  test("T2 no page under src/content/docs holds a string of a default-off flag", () => {
    const files = pageFiles(CONTENT_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect({
        file: file.slice(CONTENT_DIR.length),
        problems: flaggedTextProblems(readFileSync(file, "utf8")),
      }).toEqual({
        file: file.slice(CONTENT_DIR.length),
        problems: [],
      });
    }
  });
});
