// `bun run docs:stale [--strict] [--stamp <pl file>]` (plan D7): a Polish page names its English source and the hash of the
// source body it was written from. A changed source body makes the Polish page stale. A stale page is visible in CI and,
// with `--strict`, blocks a release when its source is public (the home page and the start pages).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliOutput, type CliOutput } from "../../server/src/platform/cli";
import { POLISH_SET } from "../src/front-matter";

const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
// A line that holds only a `<Shot … />` tag (the tag may span lines): a screenshot never stales a translation.
const SHOT_LINE = /^[ \t]*<Shot\b[^>]*?\/>[ \t]*(?:\n|$)/gm;
// The import of the component that a page with a `<Shot />` line needs: it belongs to the same screenshot, so it never stales a translation either.
const SHOT_IMPORT_LINE = /^import Shot from "(?:\.\.\/)+components\/Shot\.astro";[ \t]*(?:\n|$)/gm;

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;

// The text after the closing `---` of the front matter (the whole text when there is none).
function bodyOf(markdown: string): string {
  const match = FRONT_MATTER.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

// First 16 hex of sha256 of the body: `\r\n` as `\n`, no `<Shot />` lines, no import line of `Shot`, no trailing whitespace.
// The lines go whole, with no neighbouring blank line: a page puts each `<Shot />` line directly under a heading (`polish.test.ts`).
export function bodyHash(markdown: string): string {
  const body = bodyOf(markdown).replaceAll("\r\n", "\n").replace(SHOT_LINE, "").replace(SHOT_IMPORT_LINE, "").trimEnd();
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

// The value of a top-level `key: value` line of the front matter, without quotes; undefined when absent or empty.
export function frontMatterValue(markdown: string, key: string): string | undefined {
  const block = FRONT_MATTER.exec(markdown)?.[1];
  if (block === undefined) return undefined;
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (match?.[1] !== key) continue;
    const value = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
    return value === "" ? undefined : value;
  }
  return undefined;
}

function* pageFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* pageFiles(path);
    else if (/\.mdx?$/.test(entry)) yield path;
  }
}

// The page id of a file: a folder page `x/index.mdx` has the id `x`, as in the Astro collection. The home page keeps `pl/index`.
function pageId(contentDir: string, file: string): string {
  const id = relative(contentDir, file)
    .replaceAll("\\", "/")
    .replace(/\.mdx?$/, "");
  if (id === "index" || id === "pl/index" || !id.endsWith("/index")) return id;
  return id.slice(0, -"/index".length);
}

// The English file of an id: `x.mdx`, or `x/index.mdx` for a folder page such as `start`.
function sourceFile(contentDir: string, id: string): string | null {
  for (const name of [id, `${id}/index`]) {
    for (const extension of [".mdx", ".md"]) {
      const file = join(contentDir, `${name}${extension}`);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

export interface StaleResult {
  // Findings that fail the run: a missing source, a missing Polish page, a strict stale page.
  errors: string[];
  // `stale pl/<id> (source <id>)`, one per stale page.
  stale: string[];
  exitCode: number;
}

export interface StaleOptions {
  contentDir: string;
  strict?: boolean;
  polishSet?: readonly string[];
}

// A source of the public set: the home page and the start pages (F121 adds security and pricing).
function isPublicSource(source: string): boolean {
  return source === "index" || source.startsWith("start");
}

export function checkStale(options: StaleOptions): StaleResult {
  const { contentDir, strict = false, polishSet = POLISH_SET } = options;
  const errors: string[] = [];
  const stale: string[] = [];
  const polishIds = new Set<string>();
  for (const file of pageFiles(join(contentDir, "pl"))) {
    const id = pageId(contentDir, file);
    polishIds.add(id);
    const text = readFileSync(file, "utf8");
    const source = frontMatterValue(text, "source");
    const sourceHash = frontMatterValue(text, "sourceHash");
    if (source === undefined || sourceHash === undefined) {
      errors.push(`${id} has no source or sourceHash`);
      continue;
    }
    const english = sourceFile(contentDir, source);
    if (english === null) {
      errors.push(`${id} source ${source} not found`);
      continue;
    }
    if (bodyHash(readFileSync(english, "utf8")) === sourceHash) continue;
    stale.push(`stale ${id} (source ${source})`);
    if (strict && isPublicSource(source)) errors.push(`${id} is stale and its source ${source} is public`);
  }
  for (const id of polishSet) {
    if (!polishIds.has(`pl/${id}`)) errors.push(`missing pl/${id}`);
  }
  return { errors, stale, exitCode: errors.length === 0 ? EXIT_CLEAN : EXIT_FINDINGS };
}

// Writes the current hash of the source body into a Polish file. Changes nothing else.
export function stampFile(file: string, contentDir: string): string {
  const text = readFileSync(file, "utf8");
  const match = FRONT_MATTER.exec(text);
  const source = frontMatterValue(text, "source");
  if (!match || source === undefined) throw new Error(`stamp_no_source ${file}`);
  const english = sourceFile(contentDir, source);
  if (english === null) throw new Error(`stamp_source_missing ${source}`);
  const hash = bodyHash(readFileSync(english, "utf8"));
  // Quoted: 16 digits (or `1e5…`) would read as a number in YAML.
  const line = `sourceHash: "${hash}"`;
  const head = text.slice(0, match[0].length);
  const eol = head.includes("\r\n") ? "\r\n" : "\n";
  const block = match[1] ?? "";
  const lines = block === "" ? [] : block.split(/\r?\n/);
  const at = lines.findIndex((candidate) => /^sourceHash:/.test(candidate));
  if (at === -1) lines.push(line);
  else lines[at] = line;
  const tail = /(\r?\n)?$/.exec(head)?.[0] ?? "";
  writeFileSync(file, `---${eol}${lines.join(eol)}${eol}---${tail}${text.slice(match[0].length)}`);
  return hash;
}

export const STALE_USAGE = "usage: bun run docs:stale [--strict] [--stamp <pl file>]";

export function runStale(
  args: readonly string[],
  contentDir: string,
  out: CliOutput,
  polishSet: readonly string[] = POLISH_SET
): number {
  let strict = false;
  let stamp: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--strict") strict = true;
    else if (arg === "--stamp" && args[i + 1] !== undefined) {
      stamp = args[i + 1] ?? null;
      i += 1;
    } else {
      out.fail(STALE_USAGE);
      return EXIT_USAGE;
    }
  }
  if (stamp !== null) {
    try {
      out.print(`stamped ${stamp} sourceHash ${stampFile(stamp, contentDir)}`);
      return EXIT_CLEAN;
    } catch (error) {
      out.fail(error instanceof Error ? error.message : String(error));
      return EXIT_FINDINGS;
    }
  }
  const result = checkStale({ contentDir, strict, polishSet });
  for (const line of result.stale) out.print(line);
  for (const error of result.errors) out.fail(error);
  out.print(`stale: ${result.stale.length}`);
  return result.exitCode;
}

// `EA_DOCS_CONTENT_DIR` points the script at a fixture folder (tests only).
export function defaultContentDir(): string {
  return process.env.EA_DOCS_CONTENT_DIR ?? fileURLToPath(new URL("../src/content/docs", import.meta.url));
}

if (import.meta.main) {
  process.exit(runStale(process.argv.slice(2), defaultContentDir(), createCliOutput("docs-stale")));
}
