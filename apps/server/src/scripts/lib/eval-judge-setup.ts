import { firstEstimateUsd } from "../../modules/triage";
import type { LlmRoleTable } from "../../platform/llm";

export const JUDGE_SAME_MODEL = "judge model must differ from the model under test (ADR 0037)";

// The role whose output the judge grades: the classifier (a sim run) or the drafter (a drafter run).
export type JudgedRole = "classifier" | "drafter";

// Before any call of a `--judge` run: the judge must not grade its own model's output (same provider and same model id;
// the effort does not count), its key must exist (the message names the key, never its value) and its model needs a
// price today (the budget charges it). Null: allowed.
export function judgeSetupError(table: LlmRoleTable, at: Date, role: JudgedRole = "classifier"): string | null {
  const judge = table.roles.judge;
  const under = table.roles[role];
  if (judge.provider === under.provider && judge.model === under.model) return JUDGE_SAME_MODEL;
  const keys = table.providers[judge.provider];
  if (keys.apiKey === undefined) return `${keys.apiKeyName} is missing`;
  if (firstEstimateUsd(judge.model, at, keys.endpoint) === null) {
    return `no price for model ${judge.model}: add it to llmPrices before a judged sim run`;
  }
  return null;
}

// The rates of a sim run, for this process only (the rows are copied, the config is not changed).
// `--rpm` is the rate of the provider of `role` (the classifier, or the drafter in a drafter run). All roles on that
// provider share it, the judge too when it runs on the same provider. `--judge-rpm` sets the judge role's own rate and
// changes no provider rate. Without it the judge role keeps its own `LLM_JUDGE_RPM` (the role table sets it) or has none.
export function simRoleTable(
  table: LlmRoleTable,
  opts: { rpm: number; judge: boolean; judgeRpm?: number; role?: JudgedRole }
): LlmRoleTable {
  const classifier = table.roles[opts.role ?? "classifier"].provider;
  const providers = { ...table.providers, [classifier]: { ...table.providers[classifier], rpm: opts.rpm } };
  if (!opts.judge) return { ...table, providers };
  const judge = table.roles.judge;
  return {
    roles: { ...table.roles, judge: { ...judge, rpm: opts.judgeRpm ?? judge.rpm } },
    providers,
  };
}
