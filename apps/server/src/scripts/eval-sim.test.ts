import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { llmPrices } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { loadConfig } from "../platform/config";

import { parseEvalArgs } from "./eval-args";
import { runSim } from "./eval-sim";

const config = loadConfig({
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "o-key",
});

let dir = "";
let errors: string[] = [];
let errorSpy: ReturnType<typeof spyOn<Console, "error">>;
let logSpy: ReturnType<typeof spyOn<Console, "log">>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "f097-sim-run-"));
  errors = [];
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  logSpy = spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

// The run refuses before any client, lock or ledger line exists, so nothing can spend or stay behind.
async function refused(model: string) {
  const ledger = join(dir, "spend.jsonl");
  const runsDir = join(dir, "runs");
  const options = parseEvalArgs(["--sim", "mini", "--part", "dev", "--model", model, "--spend-ledger", ledger]);
  expect(options).toBeDefined();
  let clients = 0;
  const code = await runSim(options as NonNullable<typeof options>, {
    config,
    root: join(dir, "no-corpus"),
    runsDir,
    createLlmClient: () => {
      clients += 1;
      throw new Error("no LLM client may be created");
    },
  });
  return { code, clients, ledger, runsDir };
}

describe("runSim price refusal", () => {
  test("a model with no price is refused: no client, no ledger line, no lock", async () => {
    const run = await refused("no-such-model");
    expect(run.code).toBe(1);
    expect(errors.some((line) => line.includes("no price for model no-such-model"))).toBe(true);
    expect(run.clients).toBe(0);
    expect(existsSync(run.ledger)).toBe(false);
    expect(existsSync(run.runsDir) ? readdirSync(run.runsDir) : []).toEqual([]);
  });

  test("a model whose only price starts in the future is refused the same way", async () => {
    llmPrices["future-only-model"] = [
      { inputPerM: 1, outputPerM: 1, from: "2099-01-01", source: "test", checked: "2026-11-14" },
    ];
    try {
      const run = await refused("future-only-model");
      expect(run.code).toBe(1);
      expect(errors.some((line) => line.includes("no price for model future-only-model"))).toBe(true);
      expect(run.clients).toBe(0);
      expect(existsSync(run.ledger)).toBe(false);
      expect(existsSync(run.runsDir) ? readdirSync(run.runsDir) : []).toEqual([]);
    } finally {
      delete llmPrices["future-only-model"];
    }
  });

  test("a priced model passes the price check: the run stops later, at the missing corpus", async () => {
    const run = await refused("gpt-6-luna");
    expect(run.code).toBe(1);
    expect(errors.some((line) => line.includes("no price for model"))).toBe(false);
    expect(errors.some((line) => line.includes("corpus load failed"))).toBe(true);
    expect(run.clients).toBe(0);
    expect(existsSync(run.ledger)).toBe(false);
  });
});
