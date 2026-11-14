import { firstEstimateUsd } from "../modules/triage";
import type { LlmRoleTable } from "../platform/llm";

export const JUDGE_SAME_PROVIDER = "judge provider must differ from the classifier provider (PD-026)";

// Before any call of a `--judge` run: the judge must not grade its own provider's drafts, its key must exist
// (the message names the key, never its value) and its model needs a price today (the budget charges it). Null: allowed.
export function judgeSetupError(table: LlmRoleTable, at: Date): string | null {
  const judge = table.roles.judge;
  if (judge.provider === table.roles.classifier.provider) return JUDGE_SAME_PROVIDER;
  const keys = table.providers[judge.provider];
  if (keys.apiKey === undefined) return `${keys.apiKeyName} is missing`;
  if (firstEstimateUsd(judge.model, at) === null) {
    return `no price for model ${judge.model}: add it to llmPrices before a judged sim run`;
  }
  return null;
}
