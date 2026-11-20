import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { featureFlags, featureKeys } from "@ea/core";
import { en } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

import { changelogPage } from "./changelog-page";
import {
  expandUiText,
  FLAGGED_BOT_TEXT,
  FLAGGED_PANEL_KEYS,
  FLAGGED_TEXT,
  flaggedTextProblems,
  literalParts,
  NO_VISIBLE_TEXT,
} from "./flagged-text";
import { type PublicClaim, publicClaims } from "./security/claims";

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
  test.each([
    [`Open "${en.dla_title}" on a mail.`, `delegate_button: ${en.dla_title}`],
    [`The page says: ${en.rep_intro}`, `trust_ladder: ${en.rep_intro}`],
    [`Turn on ${en.switch_reply_drafts} in Settings.`, `reply_drafts: ${en.switch_reply_drafts}`],
    [`Open ${en.push_title} in Settings.`, `web_push: ${en.push_title}`],
    ["You can edit and send in your mail client.", "draft_copy_check: edit and send in your mail client"],
  ])("a page sentence that quotes a moved flag text fails: %s", (sentence, problem) => {
    expect(flaggedTextProblems(sentence)).toContainEqual(problem);
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

// The claims of the security page are data, not `.mdx`: the page scan does not see them.
const claimTextProblems = (claims: readonly PublicClaim[]): string[] =>
  claims.flatMap((claim) =>
    (["en", "pl"] as const).flatMap((lang) =>
      [claim.text[lang], claim.condition?.[lang] ?? ""].flatMap((text) =>
        flaggedTextProblems(text).map((problem) => `${claim.id} ${lang} ${problem}`)
      )
    )
  );

describe("the public claims", () => {
  test("no claim text or condition, in either language, holds a string of a default-off flag", () => {
    expect(claimTextProblems(publicClaims)).toEqual([]);
  });
  test("the scan reads the en and pl text and the condition of a claim", () => {
    const base = { id: "c", ledger: ["C001"], proofs: ["a"], text: { en: "Fine.", pl: "Dobrze." }, condition: null };
    expect(claimTextProblems([base])).toEqual([]);
    expect(claimTextProblems([{ ...base, text: { en: "Turn on Track my sent mail.", pl: "x" } }])).toEqual([
      `c en sent_sync: ${en.sent_switch}`,
    ]);
    expect(claimTextProblems([{ ...base, text: { en: "x", pl: pl.sent_switch } }])).toEqual([
      `c pl sent_sync: ${pl.sent_switch}`,
    ]);
    expect(claimTextProblems([{ ...base, condition: { en: "Use /review", pl: "x" } }])).toEqual([
      "c en review_command: /review",
    ]);
  });
});

// The changelog page is an in-place page: its text comes from `CHANGELOG.md` through `changelogPage`, not from `src/content/docs`.
describe("the changelog page", () => {
  const ROOT = join(import.meta.dir, "../../..");
  test("T10 the text that the changelog page publishes holds no string of a default-off flag", () => {
    const page = changelogPage(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
    expect(flaggedTextProblems(page)).toEqual([]);
  });
  test("T10 the built dist/changelog/index.html holds none (runs after docs:build)", () => {
    const file = join(ROOT, "apps/docs/dist/changelog/index.html");
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8")
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    expect(text.length).toBeGreaterThan(100);
    expect(flaggedTextProblems(text)).toEqual([]);
  });
});
