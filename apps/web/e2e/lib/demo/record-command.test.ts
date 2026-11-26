import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

// `bun run demo:record` refuses before it starts a server or touches a database. The command runs here with a PATH of our own: a folder
// that holds a fake `ffmpeg` (the check only looks for the file) or an empty folder, and the folder of this bun. No `.env` is needed: the
// two refusals under test come before the demo database keys are read.
const root = resolve(import.meta.dir, "../../../../..");
const dir = mkdtempSync(join(tmpdir(), "demo-record-command-"));
const withFfmpeg = join(dir, "with");
const without = join(dir, "without");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeBin(folder: string, files: string[]): void {
  Bun.spawnSync(["mkdir", "-p", folder]);
  for (const file of files) {
    writeFileSync(join(folder, file), "#!/bin/sh\nexit 0\n");
    chmodSync(join(folder, file), 0o755);
  }
}
makeBin(withFfmpeg, ["ffmpeg"]);
makeBin(without, []);

async function record(args: string[], pathFolder: string): Promise<{ code: number; stderr: string; stdout: string }> {
  const child = Bun.spawn([process.execPath, "apps/web/e2e/demo/record.ts", ...args], {
    cwd: root,
    env: { PATH: `${pathFolder}:${dirname(process.execPath)}`, HOME: process.env.HOME ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stderr, stdout };
}

describe("demo:record refusals", () => {
  test("--seed with a file that does not exist: exit 1 with seed_missing, no database or server touched", async () => {
    const result = await record(["--seed", "/no/such.json"], withFfmpeg);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/\bseed_missing\b/);
    expect(result.stdout).not.toContain("rebuilding the demo database");
  });
  test("a PATH without ffmpeg: exit 1 with ffmpeg_missing", async () => {
    const result = await record([], without);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ffmpeg_missing");
    expect(result.stdout).not.toContain("rebuilding the demo database");
  });
  test("--setup-only without --seed: exit 1 with setup_only_needs_seed, no database or server touched", async () => {
    const result = await record(["--setup-only"], withFfmpeg);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("setup_only_needs_seed");
    expect(result.stdout).not.toContain("rebuilding the demo database");
  });
  test("an unknown argument: exit 1 with bad_args", async () => {
    const result = await record(["--nope", "x"], withFfmpeg);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("bad_args --nope");
  });
});
