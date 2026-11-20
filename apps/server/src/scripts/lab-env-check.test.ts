import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkSimEnv } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { labAddresses, loadLabCorpus } from "../modules/lab";

const REPO = resolve(import.meta.dir, "../../../..");
const SCRIPT = resolve(import.meta.dir, "lab-env-check.ts");

// A plain KEY=value reader: comments and empty lines are skipped, the value is everything after the first "=".
function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    env[line.slice(0, at)] = line.slice(at + 1);
  }
  return env;
}

const example = readEnvFile(resolve(REPO, "deploy/sim.env.example"));

// The guard runs with exactly this env: no .env file (cwd outside the repo), no machine variable.
async function run(
  env: Record<string, string>,
  args: string[] = []
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "--no-env-file", SCRIPT, ...args], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("deploy/sim.env.example", () => {
  test("4 checkSimEnv gives [] and the send list holds every lab-01 address", async () => {
    const addresses = labAddresses(await loadLabCorpus(resolve(REPO, "evals/sim"), "lab-01"));
    expect(checkSimEnv(example, addresses)).toEqual([]);
    expect(example.SEND_TEST_ADDRESSES?.split(",").sort()).toEqual(addresses);
  });

  test("the example names the key of each provider, empty", () => {
    for (const key of ["OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"])
      expect(example).toHaveProperty([key], "");
  });

  test("no AUTH_SMTP key, the sim-only base tag, and the day cap of review N10", () => {
    expect(Object.keys(example).filter((key) => key.startsWith("AUTH_SMTP_"))).toEqual([]);
    expect(example.EA_SERVER_IMAGE).not.toBe("ea-server");
    expect(example.LLM_DAILY_CAP).toBe("600");
    expect(example.WEB_TRUSTED_PROXIES).toBe("172.31.0.1");
  });
});

describe("bun run lab:env-check", () => {
  test("the root script runs this file", () => {
    const scripts = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["lab:env-check"]).toBe("bun apps/server/src/scripts/lab-env-check.ts");
  });

  test("5 the example env passes: exit 0", async () => {
    const result = await run(example);
    expect(result).toEqual({ code: 0, stdout: "[lab-env-check] ok\n", stderr: "" });
  });

  test("5 a bot token of the real form: exit 1 and only the code on stdout", async () => {
    const token = "7234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const result = await run({ ...example, TELEGRAM_BOT_TOKEN: token });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("[lab-env-check] telegram_token_not_fake\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
  });

  test("an unknown flag exits 2 with the usage on stderr and nothing on stdout", async () => {
    const result = await run(example, ["--no-such-flag"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("usage: bun run lab:env-check");
  });

  test("an unset Telegram root, the real Telegram, is refused (review B6)", async () => {
    const rest = { ...example };
    delete rest.TELEGRAM_API_ROOT;
    const result = await run(rest);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("[lab-env-check] telegram_root_not_loopback\n");
  });
});
