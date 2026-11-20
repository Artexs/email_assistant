import { randomBytes } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { ConfigError, llmRoleTable, loadConfig, runFlagError, runOverrides } from "../platform/config";
import { llmProviderIds } from "../platform/llm";

import { evalUsage, parseEvalArgs } from "./eval-args";
import { JUDGE_SAME_MODEL, judgeSetupError } from "./lib/eval-judge-setup";

// The flags of an eval run pin one run. `runOverrides` is what `eval`, `eval --sim`, the drafter eval
// and the extractor eval hand to `llmRoleTable`; `judgeSetupError` is the check that runs before the first call.
const base = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
};
const at = new Date("2026-11-20T12:00:00Z");

/** The table of `bun run eval --sim x --part dev <args>` for a given env. */
function tableOfArgs(env: Record<string, string>, args: string[]) {
  const options = parseEvalArgs(["--sim", "x", "--part", "dev", ...args]);
  if (options === undefined) throw new Error("usage error");
  const config = loadConfig({ ...base, ...env });
  return llmRoleTable(
    config,
    runOverrides("classifier", {
      provider: options.provider,
      model: options.model,
      reasoningEffort: options["reasoning-effort"],
      judgeProvider: options["judge-provider"],
      judgeModel: options["judge-model"],
    })
  );
}

describe("eval flags", () => {
  test("1: --provider deepseek moves every role, the judge too; both are priced", () => {
    const table = tableOfArgs({ LLM_PROVIDER: "openai", DEEPSEEK_API_KEY: "d" }, ["--provider", "deepseek", "--judge"]);
    for (const role of ["classifier", "drafter", "extractor", "judge"] as const) {
      expect(table.roles[role].provider).toBe("deepseek");
    }
    expect(table.roles.classifier.model).toBe("deepseek-flash");
    expect(table.roles.judge.model).toBe("deepseek-v4-pro");
    expect(judgeSetupError(table, at)).toBeNull();
  });

  test("2: --judge-provider openai moves only the judge; its key is needed and checked", () => {
    const args = ["--provider", "deepseek", "--judge", "--judge-provider", "openai"];
    const table = tableOfArgs({ DEEPSEEK_API_KEY: "d", OPENAI_API_KEY: "o" }, args);
    expect(table.roles.classifier).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
    expect(table.roles.judge).toMatchObject({ provider: "openai", model: "gpt-6.1-terra" });
    expect(judgeSetupError(table, at)).toBeNull();
    const noKey = tableOfArgs({ DEEPSEEK_API_KEY: "d" }, args);
    expect(judgeSetupError(noKey, at)).toBe("OPENAI_API_KEY is missing");
  });

  test("3: --model of the strong tier with --judge is refused before any call", () => {
    const table = tableOfArgs({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "o" }, ["--model", "gpt-6.1-terra", "--judge"]);
    expect(judgeSetupError(table, at)).toBe(JUDGE_SAME_MODEL);
  });

  test("--model and --reasoning-effort pin the judged role only; --judge-model pins the judge", () => {
    const table = tableOfArgs({ OPENAI_API_KEY: "o" }, [
      "--model",
      "m-under-test",
      "--reasoning-effort",
      "low",
      "--judge",
      "--judge-model",
      "m-judge",
    ]);
    expect(table.roles.classifier).toMatchObject({ model: "m-under-test", reasoningEffort: "low" });
    expect(table.roles.judge.model).toBe("m-judge");
    expect(table.roles.drafter.model).not.toBe("m-under-test");
    expect(table.roles.judge.reasoningEffort).not.toBe("low");
  });

  test("8: --reasoning-effort on a provider with no effort setting is a usage error that names the flag", () => {
    let error: unknown;
    try {
      tableOfArgs({ GEMINI_API_KEY: "g" }, ["--provider", "gemini", "--reasoning-effort", "low"]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect(runFlagError(error as ConfigError)).toBe("--reasoning-effort is not accepted by this provider");
  });

  test("the usage lists every provider id, says what the default judge is and names no model", () => {
    expect(evalUsage).toContain(`--provider ${llmProviderIds.join("|")}`);
    expect(evalUsage).toContain("default judge: the strong tier of the provider");
    expect(evalUsage).not.toMatch(/\b(gpt|gemini|deepseek)-[a-z0-9.]/);
  });
});
