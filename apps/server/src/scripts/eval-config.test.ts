import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { loadEvalConfig } from "./eval-config";

const validEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
};
const BAD_URL = "http://10.0.0.5/v1";
const script = resolve(import.meta.dir, "eval.ts");
const uuid = "00000000-0000-4000-8000-000000000001";

// The CLI in a child process with only the given env: the same `main` an operator runs.
function runCli(args: string[], env: Record<string, string>) {
  const result = Bun.spawnSync(["bun", script, ...args], { env: { PATH: process.env.PATH ?? "", ...env } });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("loadEvalConfig", () => {
  let errors: string[] = [];
  let spy: ReturnType<typeof spyOn<Console, "error">>;
  beforeEach(() => {
    errors = [];
    spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
  });
  afterEach(() => spy.mockRestore());

  test("a bad key prints its name, never its value, and returns null", () => {
    const saved = { ...process.env };
    Object.assign(process.env, validEnv, { OPENAI_BASE_URL: BAD_URL });
    try {
      expect(loadEvalConfig()).toBeNull();
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
      Object.assign(process.env, saved);
    }
    expect(errors).toEqual(["[eval] config error: OPENAI_BASE_URL"]);
  });
});

describe("eval CLI with a bad OPENAI_BASE_URL (every other key valid)", () => {
  const env = { ...validEnv, OPENAI_BASE_URL: BAD_URL };

  test("12: --sim stops with the key name and exit 1", () => {
    const run = runCli(["--sim", "lab-01", "--part", "dev"], env);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("config error: OPENAI_BASE_URL");
    expect(run.stderr).not.toContain("10.0.0.5");
    expect(run.stdout).not.toContain("10.0.0.5");
  });

  test("12: the case-set run stops with the key name and exit 1", () => {
    const run = runCli([], env);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("config error: OPENAI_BASE_URL");
    expect(run.stderr).not.toContain("10.0.0.5");
  });

  test("12: --real stops with the key name and exit 1", () => {
    const run = runCli(["--real", "--org-id", uuid, "--mailbox-id", uuid], env);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("config error: OPENAI_BASE_URL");
    expect(run.stderr).not.toContain("10.0.0.5");
  });

  test("12: --suspicious still runs: it reads no config", () => {
    const run = runCli(["--sim", "lab-01", "--part", "dev", "--suspicious"], {
      OPENAI_BASE_URL: BAD_URL,
    });
    expect(run.stderr).not.toContain("config error");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("phishing recall");
  });

  test("12: with a good URL the same --sim run passes the config check", () => {
    const run = runCli(["--sim", "lab-01", "--part", "dev", "--model", "no-price-model"], validEnv);
    expect(run.stderr).not.toContain("config error");
  });
});
