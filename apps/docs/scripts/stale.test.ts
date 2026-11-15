import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { bodyHash, checkStale, frontMatterValue, runStale, stampFile } from "./stale";

const STALE_SCRIPT = join(import.meta.dir, "stale.ts");
let dir = "";

const put = (path: string, text: string) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const polish = (hash: string, source = "start") =>
  `---\ntitle: Start\nsource: ${source}\nsourceHash: "${hash}"\n---\nTekst\n`;
// The real POLISH_SET is `index`: a process run needs that pair.
const putIndex = () => {
  put("index.mdx", "---\ntitle: I\n---\nx\n");
  put("pl/index.mdx", polish(bodyHash("---\ntitle: I\n---\nx\n"), "index"));
};
// Runs the script as a process: the exit code and the two streams.
const run = (...args: string[]) => {
  const result = Bun.spawnSync([process.execPath, STALE_SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? "", EA_DOCS_CONTENT_DIR: dir },
    cwd: dir,
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "docs-stale-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("bodyHash", () => {
  test("T3 front matter, line ends, trailing whitespace and <Shot /> lines do not count", () => {
    const base = bodyHash("---\ntitle: A\n---\nHi\r\n\n");
    expect(base).toBe(bodyHash("---\ntitle: B\n---\nHi"));
    expect(base).toBe(bodyHash('---\ntitle: B\n---\nHi\n<Shot page="rules" />'));
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });
  test("a changed word, a changed middle line and a different order change the hash", () => {
    const base = bodyHash("---\nt: a\n---\nHi\nthere\n");
    expect(bodyHash("---\nt: a\n---\nHo\nthere\n")).not.toBe(base);
    expect(bodyHash("---\nt: a\n---\nthere\nHi\n")).not.toBe(base);
  });
  test("leading whitespace and inner blank lines count", () => {
    expect(bodyHash("---\nt: a\n---\n Hi")).not.toBe(bodyHash("---\nt: a\n---\nHi"));
    expect(bodyHash("---\nt: a\n---\nA\n\nB")).not.toBe(bodyHash("---\nt: a\n---\nA\nB"));
  });
  test("a Shot tag in the middle of a line, or text next to it, still counts", () => {
    const base = bodyHash("---\nt: a\n---\nHi");
    expect(bodyHash('---\nt: a\n---\nHi\nsee <Shot page="x" /> here')).not.toBe(base);
    expect(bodyHash('---\nt: a\n---\nHi\n<Shot page="x" /> after')).not.toBe(base);
  });
  test("a Shot tag over several lines does not count", () => {
    expect(bodyHash('---\nt: a\n---\nHi\n<Shot\n  page="x"\n/>\n')).toBe(bodyHash("---\nt: a\n---\nHi"));
  });
  test("a text without front matter hashes as a whole body; an empty front matter is cut", () => {
    expect(bodyHash("Hi\n")).toBe(bodyHash("---\n---\nHi"));
    expect(bodyHash("---\nt: a\n---\nHi")).toBe(bodyHash("Hi"));
  });
});

describe("frontMatterValue", () => {
  test("reads a plain, a double-quoted and a single-quoted value; absent or empty is undefined", () => {
    const text = `---\nsource: start\nsourceHash: "abc"\nother: 'x y'\nempty:\n---\nsource: no\n`;
    expect(frontMatterValue(text, "source")).toBe("start");
    expect(frontMatterValue(text, "sourceHash")).toBe("abc");
    expect(frontMatterValue(text, "other")).toBe("x y");
    expect(frontMatterValue(text, "empty")).toBeUndefined();
    expect(frontMatterValue(text, "nothing")).toBeUndefined();
    expect(frontMatterValue("no front matter\nsource: x", "source")).toBeUndefined();
  });
});

describe("docs:stale", () => {
  test("T4 a matching hash: exit 0 and `stale: 0`", () => {
    putIndex();
    put("start.md", "---\ntitle: S\n---\nHello\n");
    put("pl/start.mdx", polish(bodyHash("---\ntitle: S\n---\nHello\n")));
    const result = run();
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/\[docs-stale\] stale: \d+\n/);
    expect(result.err).toBe("");
  });
  test("T5 a changed English body: exit 0 with one `stale` line; --strict with source `start` exits 1", () => {
    putIndex();
    put("start.md", "---\ntitle: S\n---\nHello\n");
    put("pl/start.mdx", polish(bodyHash("---\ntitle: S\n---\nHello\n")));
    put("start.md", "---\ntitle: S\n---\nHello again\n");
    const lax = run();
    expect(lax.code).toBe(0);
    expect(lax.out).toContain("stale pl/start (source start)");
    expect(lax.out).toContain("stale: 1");
    const strict = run("--strict");
    expect(strict.code).toBe(1);
    expect(strict.out).toContain("stale pl/start (source start)");
    expect(strict.err).toContain("pl/start is stale and its source start is public");
  });
  test("--strict is for the public set only: a stale page with another source exits 0", () => {
    putIndex();
    put("how-to/x.md", "---\ntitle: S\n---\nOld\n");
    put("pl/how-to/x.mdx", polish(bodyHash("---\ntitle: S\n---\nOld\n"), "how-to/x"));
    put("how-to/x.md", "---\ntitle: S\n---\nNew\n");
    const result = run("--strict");
    expect(result.code).toBe(0);
    expect(result.out).toContain("stale: 1");
  });
  test("--strict also fails a stale page whose source is `index` or begins with `start`", () => {
    for (const source of ["index", "start/first-steps", "start"]) {
      const file = `${source}.md`;
      put(file, "---\ntitle: S\n---\nOld\n");
      const result = checkStale({ contentDir: dir, strict: true, polishSet: [] });
      expect(result.errors).toEqual([]);
      put(`pl/${source}.mdx`, polish(bodyHash("---\ntitle: S\n---\nOld\n"), source));
      put(file, "---\ntitle: S\n---\nNew\n");
      expect(checkStale({ contentDir: dir, strict: true, polishSet: [] }).exitCode).toBe(1);
      expect(checkStale({ contentDir: dir, strict: false, polishSet: [] }).exitCode).toBe(0);
      rmSync(join(dir, `pl/${source}.mdx`));
      rmSync(join(dir, file));
    }
  });
  test("T6 a POLISH_SET id without a Polish page: exit 1 and `missing pl/<id>`", () => {
    put("start.md", "---\ntitle: S\n---\nHello\n");
    const result = checkStale({ contentDir: dir, polishSet: ["start"] });
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(["missing pl/start"]);
    // The real script: its POLISH_SET is `index`.
    const process = run();
    expect(process.code).toBe(1);
    expect(process.err).toContain("missing pl/index");
  });
  test("a Polish page with no source, no sourceHash, or a missing source page is an error", () => {
    put("pl/a.mdx", "---\ntitle: A\n---\nx\n");
    put("pl/b.mdx", "---\ntitle: B\nsource: start\n---\nx\n");
    put("pl/c.mdx", polish("0123456789abcdef", "gone"));
    const result = checkStale({ contentDir: dir, polishSet: [] });
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      "pl/a has no source or sourceHash",
      "pl/b has no source or sourceHash",
      "pl/c source gone not found",
    ]);
  });
  test("a wrong sourceHash is stale", () => {
    put("start.md", "---\ntitle: S\n---\nHello\n");
    put("pl/start.mdx", polish("0000000000000000"));
    expect(checkStale({ contentDir: dir, polishSet: [] }).stale).toEqual(["stale pl/start (source start)"]);
  });
  test("a source can be an .mdx page", () => {
    put("start.mdx", "---\ntitle: S\n---\nHello\n");
    put("pl/start.mdx", polish(bodyHash("---\ntitle: S\n---\nHello\n")));
    expect(checkStale({ contentDir: dir, polishSet: [] })).toEqual({ errors: [], stale: [], exitCode: 0 });
  });
  test("T7 --stamp writes the hash and nothing else; then T4 holds", () => {
    put("start.md", "---\ntitle: S\n---\nHello\n");
    put("pl/start.mdx", "---\ntitle: Start\nsource: start\n---\nTekst\n");
    putIndex();
    const file = join(dir, "pl/start.mdx");
    const result = run("--stamp", file);
    expect(result.code).toBe(0);
    const hash = bodyHash("---\ntitle: S\n---\nHello\n");
    expect(readFileSync(file, "utf8")).toBe(`---\ntitle: Start\nsource: start\nsourceHash: "${hash}"\n---\nTekst\n`);
    const check = run();
    expect(check.code).toBe(0);
    expect(check.out).toContain("stale: 0");
  });
  test("--stamp replaces an old sourceHash, keeps the other lines, and keeps CRLF", () => {
    put("start.md", "---\ntitle: S\n---\nHello\n");
    const crlf = '---\r\ntitle: Start\r\nsourceHash: "old"\r\nsource: start\r\n---\r\nTekst\r\n';
    put("pl/start.mdx", crlf);
    const hash = stampFile(join(dir, "pl/start.mdx"), dir);
    expect(readFileSync(join(dir, "pl/start.mdx"), "utf8")).toBe(
      `---\r\ntitle: Start\r\nsourceHash: "${hash}"\r\nsource: start\r\n---\r\nTekst\r\n`
    );
  });
  test("--stamp of a file with no source, or with a missing source page, fails and leaves the file", () => {
    put("pl/a.mdx", "---\ntitle: A\n---\nx\n");
    put("pl/b.mdx", "---\ntitle: B\nsource: gone\n---\nx\n");
    const a = run("--stamp", join(dir, "pl/a.mdx"));
    expect(a.code).toBe(1);
    expect(a.err).toContain("stamp_no_source");
    const b = run("--stamp", join(dir, "pl/b.mdx"));
    expect(b.code).toBe(1);
    expect(b.err).toContain("stamp_source_missing gone");
    expect(readFileSync(join(dir, "pl/a.mdx"), "utf8")).toBe("---\ntitle: A\n---\nx\n");
  });
  test("an unknown option or `--stamp` without a file exits 2 with the usage line", () => {
    for (const args of [["--nope"], ["--stamp"]]) {
      const result = run(...args);
      expect(result.code).toBe(2);
      expect(result.err).toContain("usage: bun run docs:stale");
    }
  });
  test("runStale prints through the output object, not the console", () => {
    put("start.md", "---\ntitle: S\n---\nHello\n");
    put("pl/start.mdx", polish("0000000000000000"));
    const lines: string[] = [];
    const out = {
      print: (text: string) => void lines.push(`P ${text}`),
      fail: (text: string) => void lines.push(`F ${text}`),
    };
    expect(runStale(["--strict"], dir, out)).toBe(1);
    expect(lines).toEqual([
      "P stale pl/start (source start)",
      "F pl/start is stale and its source start is public",
      "F missing pl/index",
      "P stale: 1",
    ]);
  });
});

describe("the real repository", () => {
  test("`docs:stale` is is wired in package.json and passes on the real pages", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["docs:stale"]).toBe("bun apps/docs/scripts/stale.ts");
    expect(manifest.scripts["test:unit"]).toContain("apps/docs/scripts");
    const result = Bun.spawnSync([process.execPath, STALE_SCRIPT], { env: { PATH: process.env.PATH ?? "" } });
    expect(result.stdout.toString()).toMatch(/\[docs-stale\] stale: \d+\n/);
    expect(result.exitCode).toBe(0);
  });
});
