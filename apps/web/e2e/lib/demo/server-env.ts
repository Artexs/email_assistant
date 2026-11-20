// The server env of the demo-source recording, and the guard that keeps demo mail away from every model but the replay.
// `demoServerEnv` is pure. `assertLoopbackLlm` builds the role table the server builds and refuses anything else than the loopback replay.
import { MINUTE_MS } from "@ea/core";

import { ConfigError, llmRoleTable, loadConfig } from "../../../../server/src/platform/config";
import { type LlmRoleTable } from "../../../../server/src/platform/llm";

import { DEMO_STEPS } from "./steps";

export interface DemoServerEnvOptions {
  replayPort: number;
  model: string;
  /** The folder that holds the gate copy of the run. */
  gateDir: string;
  /** The delegate of the step-6 send: the one address the send scope lets through. */
  sendTestAddress: string;
}

/** The env of the demo servers on top of `e2eEnv()`: scope `synthetic`, the replay as an own OpenAI endpoint, the gate copy. */
export function demoServerEnv(base: Record<string, string>, opts: DemoServerEnvOptions): Record<string, string> {
  return {
    ...base,
    TRIAGE_LLM_SCOPE: "synthetic",
    LLM_PROVIDER: "openai",
    OPENAI_BASE_URL: `http://127.0.0.1:${opts.replayPort}/v1`,
    OPENAI_OWN_MODEL: opts.model,
    OPENAI_OWN_API_KEY: "",
    GATE_EVIDENCE_DIR: opts.gateDir,
    SEND_TEST_ADDRESSES: opts.sendTestAddress,
    MAIL_SYNC_EVERY_MIN: "2",
  };
}

const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "::1", "localhost"];

/** The first reason why the role table can reach a model other than the loopback replay; null when it cannot. */
export function loopbackProblem(scope: string | undefined, table: LlmRoleTable): string | null {
  if (scope !== "synthetic") return "scope";
  for (const [role, row] of Object.entries(table.roles)) {
    if (row.provider !== "openai") return `${role} provider`;
    const provider = table.providers[row.provider];
    if (provider.endpoint !== "own") return `${role} endpoint`;
    const host = provider.baseUrl === null ? null : new URL(provider.baseUrl).hostname.replace(/^\[|\]$/g, "");
    if (host === null || !LOOPBACK_HOSTS.includes(host)) return `${role} host`;
  }
  return null;
}

/**
 * Builds the role table of the server env (`loadConfig`, `llmRoleTable`) and throws `demo_llm_not_loopback` unless the scope is
 * `synthetic` and every role row is the `openai` provider on an own endpoint on loopback. A developer `.env` key cannot pass it.
 */
export function assertLoopbackLlm(env: Record<string, string | undefined>): void {
  let table: LlmRoleTable;
  try {
    table = llmRoleTable(loadConfig(env));
  } catch (error) {
    if (error instanceof ConfigError) throw new Error(`demo_llm_not_loopback: config ${error.keys.join(",")}`);
    throw error;
  }
  const problem = loopbackProblem(env.TRIAGE_LLM_SCOPE, table);
  if (problem !== null) throw new Error(`demo_llm_not_loopback: ${problem}`);
}

/** The limits of the waits between steps. A wait that passes its limit fails with `demo_wait_timeout <what>`. */
export const DEMO_WAIT_LIMITS_MS = {
  firstSync: 3 * MINUTE_MS,
  shadowTriaged: 3 * MINUTE_MS,
  historyDone: 8 * MINUTE_MS,
  afterTap: 4 * MINUTE_MS,
  delegationSent: 2 * MINUTE_MS,
} as const;

const TEST_MARGIN_MS = 5 * MINUTE_MS;

/** The Playwright test timeout of the demo source: every wait at its limit, the planned seconds of the steps, and 5 minutes. */
export function demoTestTimeoutMs(): number {
  const waits = Object.values(DEMO_WAIT_LIMITS_MS).reduce((sum, limit) => sum + limit, 0);
  const steps = DEMO_STEPS.reduce((sum, step) => sum + step.seconds * 1000, 0);
  return waits + steps + TEST_MARGIN_MS;
}
