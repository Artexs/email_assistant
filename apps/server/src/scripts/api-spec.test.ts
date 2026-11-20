import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildSpecText, parseApiSpecArgs, REPO_ROOT, SPEC_FILE } from "./lib/api-spec-build";

const committed = (): string => readFileSync(join(REPO_ROOT, SPEC_FILE), "utf8");

describe("the committed OpenAPI file", () => {
  test("T2 equals the output of the app built with fakes (run `bun run api:spec` after a route change)", async () => {
    expect(committed() === (await buildSpecText())).toBe(true);
  });
  test("T3 holds no operator, auth or file path", () => {
    const spec = JSON.parse(committed()) as { paths: Record<string, unknown> };
    const hidden = Object.keys(spec.paths).filter((path) => /^\/api\/(operator|auth|openapi\.json)(\/|$)/.test(path));
    expect(hidden).toEqual([]);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(50);
  });
  test("T4 two builds give the same bytes", async () => {
    expect((await buildSpecText()) === (await buildSpecText())).toBe(true);
  });
  test("the file is 2-space JSON with one newline at the end, version 0 and no server URL", () => {
    const text = committed();
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    const spec = JSON.parse(text) as { info: { version: string }; servers?: unknown };
    expect(spec.info.version).toBe("0");
    expect(spec.servers).toBeUndefined();
  });
});

describe("the api:spec arguments", () => {
  test("no argument writes, --check checks, anything else is a usage error", () => {
    expect(parseApiSpecArgs([])).toEqual({ check: false });
    expect(parseApiSpecArgs(["--check"])).toEqual({ check: true });
    expect(parseApiSpecArgs(["--out", "x"])).toBeNull();
    expect(parseApiSpecArgs(["--check", "x"])).toBeNull();
  });
});

describe("bun run api:spec --check", () => {
  test("T1 exits 0 at HEAD", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "api-spec.ts"), "--check"], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: undefined, WEB_AUTH_SECRET: undefined },
    });
    expect({ code: run.exitCode, out: run.stdout.toString() }).toMatchObject({ code: 0 });
    expect(run.stdout.toString()).toContain("openapi_ok");
  });
});
