import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// The provider scan (the one-LLM-provider ticket in `spec/features/active/`). A provider id, a model id, a provider env key, a
// provider list in a usage text or a provider host may be written only in the registry files. Every other file that
// names one is in `ALLOWED_SITES` with its reason, and an entry whose file no longer has a match fails the test: a
// removed site must leave the list.

const REPO_ROOT = join(import.meta.dir, "../../../../..");

const SCAN_ROOTS = ["apps/server/src", "packages/core/src", "apps/web/src", "tools"];

/** Path prefixes that may name providers. `packages/core/src/llm-providers.ts` does not exist until the core catalog stage. */
export const REGISTRY_PATHS = ["apps/server/src/platform/llm/providers/", "packages/core/src/llm-providers.ts"];

/** File path -> reason. Every entry is a permanent exception: `stays: <reason>`. */
export const ALLOWED_SITES: Record<string, string> = {
  "apps/server/src/platform/outside-services.ts": "stays: a hand list by design, each outside key is a decision",
  "apps/server/src/scripts/e2e-seed/args-llm-pin.ts":
    "stays: the e2e pin sets every removed key and OPENAI_OWN_MODEL to empty text",
  "packages/core/src/legal/subprocessors.ts":
    "stays: the legal rows name the sub-processors, the owner wants no legal change",
  "packages/core/src/metrics/cost-model.ts": "stays: measured record (pilot weeks), not catalog data",
};

const REASON_FORMAT = /^stays: \S.*$/;

const PROVIDERS = "openai|gemini|deepseek";

/** One pattern per way a provider name gets into code. Comments count: a comment that names a model is stale data. */
export const PROVIDER_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "provider id literal", re: new RegExp(`["'\`](${PROVIDERS})["'\`]`) },
  { name: "model id", re: /\b(gpt|gemini|deepseek)-[a-z0-9.]/ },
  { name: "provider env key", re: /\b(OPENAI|GEMINI|DEEPSEEK)_[A-Z]/ },
  { name: "provider list in a text", re: new RegExp(`\\b(${PROVIDERS})\\s*\\|\\s*(${PROVIDERS})\\b`, "i") },
  { name: "provider host", re: /\b(openai|deepseek)\.com\b|generativelanguage\.googleapis/ },
];

/** The matches of one file text as `line N: <pattern name>: <text>`. */
export function providerMatches(text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, index) => {
    for (const { name, re } of PROVIDER_PATTERNS) {
      const hit = re.exec(line);
      if (hit) found.push(`line ${index + 1}: ${name}: ${hit[0]}`);
    }
  });
  return found;
}

const SKIPPED_SEGMENTS = new Set(["test", "e2e", "fixtures", "node_modules", "__snapshots__"]);
const SKIPPED_FILE = /(\.test\.tsx?|^testing\.ts|^fixtures\.ts)$/;

/** Test code, fixtures and test helpers are not scanned. */
export function isScannedPath(path: string): boolean {
  const parts = path.split("/");
  const file = parts[parts.length - 1] ?? "";
  if (!/\.tsx?$/.test(file) || SKIPPED_FILE.test(file)) return false;
  return !parts.slice(0, -1).some((part) => SKIPPED_SEGMENTS.has(part));
}

export function isRegistryPath(path: string): boolean {
  return REGISTRY_PATHS.some((prefix) => path.startsWith(prefix));
}

export interface ScanProblems {
  /** Files with a match that are neither registry files nor in the list. */
  unlisted: string[];
  /** Listed files with no match (or no file), and entries with a bad reason. */
  stale: string[];
}

/** `files`: path -> text, scanned files only. Pure: the tests feed it strings. */
export function findProblems(files: Record<string, string>, allowed: Record<string, string>): ScanProblems {
  const unlisted: string[] = [];
  const stale: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (isRegistryPath(path) || path in allowed) continue;
    for (const hit of providerMatches(text)) unlisted.push(`${path} ${hit}`);
  }
  for (const [path, reason] of Object.entries(allowed)) {
    if (!REASON_FORMAT.test(reason)) stale.push(`${path}: reason must be "stays: <reason>", got "${reason}"`);
    const text = files[path];
    if (text === undefined || providerMatches(text).length === 0)
      stale.push(`${path}: no provider match left, remove the entry`);
  }
  return { unlisted, stale };
}

async function readScannedFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const root of SCAN_ROOTS) {
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    for await (const rel of glob.scan({ cwd: join(REPO_ROOT, root), onlyFiles: true })) {
      const path = `${root}/${rel}`;
      if (isScannedPath(path)) files[path] = await Bun.file(join(REPO_ROOT, path)).text();
    }
  }
  return files;
}

describe("provider scan", () => {
  test("no provider site outside the registry and the list, and no stale list entry", async () => {
    const files = await readScannedFiles();
    expect(Object.keys(files).length).toBeGreaterThan(200);
    const { unlisted, stale } = findProblems(files, ALLOWED_SITES);
    expect({ unlisted, stale }).toEqual({ unlisted: [], stale: [] });
  });

  test("a model id in an unlisted file fails", () => {
    const { unlisted } = findProblems({ "apps/server/src/modules/triage/new.ts": 'const m = "gpt-6-luna";' }, {});
    expect(unlisted).toEqual(["apps/server/src/modules/triage/new.ts line 1: model id: gpt-6"]);
  });

  test("a registry file may name a provider", () => {
    const files = { "apps/server/src/platform/llm/providers/deepseek.ts": 'const m = "gpt-6-luna";' };
    expect(findProblems(files, {})).toEqual({ unlisted: [], stale: [] });
  });

  test("a listed file with no match is stale", () => {
    const allowed = { "apps/server/src/platform/old.ts": "stays: a test reason" };
    expect(findProblems({ "apps/server/src/platform/old.ts": "" }, allowed).stale).toEqual([
      "apps/server/src/platform/old.ts: no provider match left, remove the entry",
    ]);
    expect(findProblems({}, allowed).stale).toHaveLength(1);
  });

  test("a listed reason has the stays form", () => {
    const allowed = { "apps/server/src/platform/x.ts": "legacy" };
    const { stale } = findProblems({ "apps/server/src/platform/x.ts": '"openai"' }, allowed);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("reason must be");
  });

  test("a usage list and a host literal match", () => {
    expect(providerMatches('"--provider gemini|openai"')).toEqual(["line 1: provider list in a text: gemini|openai"]);
    expect(providerMatches('const host = "api.openai.com";')).toEqual(["line 1: provider host: openai.com"]);
    expect(
      providerMatches('const host = "https://api.deepseek.com";').some((hit) => hit.includes("provider host"))
    ).toBe(true);
    expect(providerMatches('const u = "https://generativelanguage.googleapis.com/";')).toHaveLength(1);
  });

  test("an env key and a provider id literal match, a plain word does not", () => {
    expect(providerMatches("process.env.DEEPSEEK_API_KEY")).toHaveLength(1);
    expect(providerMatches("const id = `deepseek`;")).toHaveLength(1);
    expect(providerMatches("const llmProviderIds = []; // a provider")).toEqual([]);
  });

  test("a test file, a fixture and a helper are not scanned", () => {
    for (const path of [
      "apps/server/src/modules/triage/x.test.ts",
      "apps/web/src/lib/x.test.tsx",
      "apps/server/src/platform/llm/testing.ts",
      "apps/server/test/setup.ts",
      "apps/web/e2e/gate.ts",
      "packages/core/src/metrics/fixtures.ts",
      "packages/core/src/fixtures/a.ts",
      "tools/fake-telegram/test/setup.ts",
    ])
      expect(isScannedPath(path), path).toBe(false);
    expect(isScannedPath("apps/server/src/modules/triage/service.ts")).toBe(true);
    expect(isScannedPath("tools/fake-telegram/src/server.ts")).toBe(true);
  });
});
