import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { llmRoleTable, loadConfig } from "../../../../server/src/platform/config";
import { uniformRoleTable } from "../../../../server/src/platform/llm";
import {
  globalEvidenceFor,
  loadGateEvidence,
  prompts,
  runningEvidenceKey,
} from "../../../../server/src/modules/triage";

import { readClassifierGates, writeGateDir } from "./gate-files";
import { demoGateCopy } from "./run-plan";
import { assertLoopbackLlm, demoServerEnv, demoTestTimeoutMs, loopbackProblem } from "./server-env";

const MODEL = "gpt-6-luna";
const GATE_DIR = resolve(import.meta.dir, "../../../../../evals/results/gate");
const tmp = mkdtempSync(join(tmpdir(), "demo-server-env-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  TRIAGE_LLM_SCOPE: "off",
  MAIL_SYNC_EVERY_MIN: "5",
};
const demoEnv = demoServerEnv(base, {
  replayPort: 41234,
  model: MODEL,
  gateDir: "/tmp/demo-gate",
  sendTestAddress: "marta@kordelan.test",
});

describe("demoServerEnv", () => {
  test("sets the eight keys of the demo servers over the base", () => {
    expect({
      TRIAGE_LLM_SCOPE: demoEnv.TRIAGE_LLM_SCOPE,
      LLM_PROVIDER: demoEnv.LLM_PROVIDER,
      OPENAI_BASE_URL: demoEnv.OPENAI_BASE_URL,
      OPENAI_OWN_MODEL: demoEnv.OPENAI_OWN_MODEL,
      OPENAI_OWN_API_KEY: demoEnv.OPENAI_OWN_API_KEY,
      GATE_EVIDENCE_DIR: demoEnv.GATE_EVIDENCE_DIR,
      SEND_TEST_ADDRESSES: demoEnv.SEND_TEST_ADDRESSES,
      MAIL_SYNC_EVERY_MIN: demoEnv.MAIL_SYNC_EVERY_MIN,
    }).toEqual({
      TRIAGE_LLM_SCOPE: "synthetic",
      LLM_PROVIDER: "openai",
      OPENAI_BASE_URL: "http://127.0.0.1:41234/v1",
      OPENAI_OWN_MODEL: "gpt-6-luna",
      OPENAI_OWN_API_KEY: "",
      GATE_EVIDENCE_DIR: "/tmp/demo-gate",
      SEND_TEST_ADDRESSES: "marta@kordelan.test",
      MAIL_SYNC_EVERY_MIN: "2",
    });
    expect(demoEnv.DATABASE_URL).toBe(base.DATABASE_URL);
  });
});

describe("assertLoopbackLlm", () => {
  test("the demo env passes", () => {
    expect(() => assertLoopbackLlm(demoEnv)).not.toThrow();
  });

  test.each([
    ["a public OpenAI host", { OPENAI_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "o-key" }],
    ["a private network host", { OPENAI_BASE_URL: "http://10.0.0.5:1/v1" }],
    ["scope all", { TRIAGE_LLM_SCOPE: "all" }],
    ["another provider", { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "d-key" }],
  ])("%s throws demo_llm_not_loopback", (_name, change) => {
    expect(() => assertLoopbackLlm({ ...demoEnv, ...change })).toThrow("demo_llm_not_loopback");
  });

  test.each([
    ["127.0.0.1", "http://127.0.0.1:1/v1"],
    ["::1", "http://[::1]:1/v1"],
    ["localhost", "http://localhost:1/v1"],
  ])("the loopback host %s passes", (_name, url) => {
    expect(loopbackProblem("synthetic", llmRoleTable(loadConfig({ ...demoEnv, OPENAI_BASE_URL: url })))).toBeNull();
  });

  test("a row on another provider is refused whatever its endpoint (the provider check alone)", () => {
    const row = { provider: "deepseek", model: MODEL, timeoutMs: 1000, rpm: null, reasoningEffort: null } as const;
    const table = uniformRoleTable(row, {
      apiKeyName: "X",
      apiKey: "k",
      rpm: 10,
      baseUrl: "http://127.0.0.1:1/v1",
      endpoint: "own",
    });
    expect(loopbackProblem("synthetic", table)).toBe("classifier provider");
  });
});

describe("the gate copy and the demo server", () => {
  const source = readClassifierGates(GATE_DIR).find(
    (gate) => gate.promptVersion === prompts.classifier.version && gate.model === MODEL
  );
  if (source === undefined) throw new Error("no committed classifier gate file for the production prompt");
  const provisional = {
    ...source,
    provisional: true,
    audit: "pending" as const,
    categories: { ...source.categories, info: { ...source.categories.info, decision: "go" as const, threshold: 0.95 } },
  };

  test("the copy is evidence for the running key: go for info, and not provisional", () => {
    const copy = demoGateCopy(provisional, { model: MODEL, host: "127.0.0.1" });
    const dir = join(tmp, "match");
    writeGateDir(dir, copy);
    const key = runningEvidenceKey(llmRoleTable(loadConfig(demoEnv)));
    const evidence = globalEvidenceFor(loadGateEvidence(dir, { quiet: true }), key);
    expect({ decision: evidence.info.decision, provisional: evidence.info.provisional }).toEqual({
      decision: "go",
      provisional: false,
    });
    expect(copy.sourceProvisional).toBe(true);
  });

  test("a copy under another host is no evidence for the running key", () => {
    const copy = demoGateCopy(provisional, { model: MODEL, host: "127.0.0.1" });
    const dir = join(tmp, "other-host");
    writeGateDir(dir, { ...copy, file: { ...copy.file, host: "127.0.0.2" } });
    const key = runningEvidenceKey(llmRoleTable(loadConfig(demoEnv)));
    expect(globalEvidenceFor(loadGateEvidence(dir, { quiet: true }), key).info.decision).toBe("none");
  });
});

describe("demoTestTimeoutMs", () => {
  test("is 20 minutes of waits, 116 seconds of steps and 5 minutes", () => {
    expect(demoTestTimeoutMs()).toBe(1_616_000);
  });
});
