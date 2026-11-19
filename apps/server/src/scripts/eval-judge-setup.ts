import { firstEstimateUsd } from "../modules/triage";
import type { LlmRoleTable } from "../platform/llm";

export const JUDGE_SAME_PROVIDER = "judge provider must differ from the classifier provider (PD-026)";
export const JUDGE_SAME_PROVIDER_DRAFTER = "judge provider must differ from the drafter provider (PD-026)";

// The role whose output the judge grades: the classifier (a sim run) or the drafter (a drafter run).
export type JudgedRole = "classifier" | "drafter";

// Before any call of a `--judge` run: the judge must not grade its own provider's drafts, its key must exist
// (the message names the key, never its value) and its model needs a price today (the budget charges it). Null: allowed.
export function judgeSetupError(table: LlmRoleTable, at: Date, role: JudgedRole = "classifier"): string | null {
  const judge = table.roles.judge;
  if (judge.provider === table.roles[role].provider) {
    return role === "drafter" ? JUDGE_SAME_PROVIDER_DRAFTER : JUDGE_SAME_PROVIDER;
  }
  const keys = table.providers[judge.provider];
  if (keys.apiKey === undefined) return `${keys.apiKeyName} is missing`;
  if (firstEstimateUsd(judge.model, at, keys.endpoint) === null) {
    return `no price for model ${judge.model}: add it to llmPrices before a judged sim run`;
  }
  return null;
}

// The rates of a sim run, for this process only (the rows are copied, the config is not changed).
// `--rpm` is the rate of the provider of `role` (the classifier, or the drafter in a drafter run). The judge provider keeps the rate of the config; the judge role keeps
// `LLM_JUDGE_RPM` also when `--judge-provider` moved the role (the table drops the role's env keys then).
// `--judge-rpm` replaces the judge provider's rate and drops the role's own rate.
export function simRoleTable(
  table: LlmRoleTable,
  opts: { rpm: number; judge: boolean; judgeRpm?: number; judgeRoleRpm?: number; role?: JudgedRole }
): LlmRoleTable {
  const classifier = table.roles[opts.role ?? "classifier"].provider;
  const providers = { ...table.providers, [classifier]: { ...table.providers[classifier], rpm: opts.rpm } };
  if (!opts.judge) return { ...table, providers };
  const judge = table.roles.judge;
  if (opts.judgeRpm !== undefined) {
    providers[judge.provider] = { ...providers[judge.provider], rpm: opts.judgeRpm };
    return { roles: { ...table.roles, judge: { ...judge, rpm: null } }, providers };
  }
  return { roles: { ...table.roles, judge: { ...judge, rpm: opts.judgeRoleRpm ?? judge.rpm } }, providers };
}
