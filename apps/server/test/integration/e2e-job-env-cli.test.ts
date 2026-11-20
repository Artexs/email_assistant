import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { portBlock } from "../../src/scripts/e2e-job-env-args";

const script = resolve(import.meta.dir, "../../src/scripts/e2e-job-env.ts");
const tmp = mkdtempSync(join(tmpdir(), "f136-s03-"));
const first = join(tmp, "first");
const other = join(tmp, "other");

function git(cwd: string, args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@x.test", "-c", "commit.gpgsign=false", ...args],
    { cwd, env, stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

async function run(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", script, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function canBind(port: number): boolean {
  try {
    Bun.listen({ hostname: "127.0.0.1", port, socket: { data: () => undefined } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  mkdirSync(first);
  git(first, ["init", "-q", "-b", "main"]);
  git(first, ["commit", "-q", "--allow-empty", "-m", "init"]);
  git(first, ["worktree", "add", "-q", other, "-b", "other"]);
  writeFileSync(join(other, ".env"), "E2E_PORT=28560\nSECRET=do-not-print\n");
  // The own `.env` of the job is not a claim.
  writeFileSync(join(first, ".env"), "E2E_PORT=28570\n");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("e2e-job-env", () => {
  test("skips the block that another worktree names, prints four lines and no other .env line", async () => {
    const result = await run(first, ["--job-name", "2026-11-19-1ac5ae68"]);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("do-not-print");
    expect(result.stdout).not.toContain("SECRET");
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(4);
    const [app, telegram, docs, tag] = lines;
    // Slot 856 is taken by the other worktree. The next free slot is 857; a busy port moves the pick on, never to 856.
    const slot = (Number(app?.slice("E2E_PORT=".length)) - 20000) / 10;
    expect(slot).toBeGreaterThan(856);
    const block = portBlock(slot);
    expect([app, telegram, docs, tag]).toEqual([
      `E2E_PORT=${block.app}`,
      `E2E_TELEGRAM_PORT=${block.telegram}`,
      `DOCS_TEST_PORT=${block.docs}`,
      "E2E_MAIL_TAG=1ac5ae68",
    ]);
    if ([28570, 28571, 28572].every(canBind)) expect(slot).toBe(857);
  });

  test("exits 1 with `no free e2e port block` when every slot is claimed", async () => {
    const claimedAll = Array.from({ length: 1000 }, (_, slot) => `E2E_PORT=${20000 + 10 * slot}`).join("\n");
    writeFileSync(join(other, ".env"), `${claimedAll}\n`);
    const result = await run(first, ["--job-name", "2026-11-19-1ac5ae68"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no free e2e port block");
  });

  test("--help with no env exits 0 and prints the usage on stdout", async () => {
    const proc = Bun.spawn(["bun", "--no-env-file", script, "--help"], {
      cwd: first,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(stdout).toContain("usage: bun run e2e:job-env --job-name <date>-<hash>");
  });

  test("a bad argument exits 2", async () => {
    expect((await run(first, [])).code).toBe(2);
    expect((await run(first, ["--job-name"])).code).toBe(2);
    expect((await run(first, ["--job-name", "x", "extra"])).code).toBe(2);
  });
});
