import type { LlmClient, LlmUsage } from "../../platform/llm";

import { prompts } from "./prompts";
import { judgeSchema, type RubricKind, rubricItems } from "./prompts/judge-v1";

export interface JudgeResult {
  kind: RubricKind;
  scores: Record<string, 0 | 1 | 2>;
  checks: Record<string, boolean>;
  passed: boolean;
}

// The draft passes when every check is true, every score is at least 1 and the code checks passed.
export function judgePassed(result: Omit<JudgeResult, "passed">, codeChecksPassed: boolean): boolean {
  return (
    codeChecksPassed &&
    Object.values(result.checks).every((value) => value) &&
    Object.values(result.scores).every((value) => value >= 1)
  );
}

// One LLM call per draft. LLM errors go to the caller unchanged. The answer has no free text.
// `passed` of the result is the rubric alone: the eval joins it with the code checks (`judgePassed`).
export async function judgeDraft(
  llm: LlmClient,
  input: Parameters<typeof prompts.judge.buildUser>[0],
  opts: { model?: string } = {}
): Promise<{ result: JudgeResult; usage: LlmUsage }> {
  const { data, usage } = await llm.generate({
    role: prompts.judge.role,
    promptVersion: prompts.judge.version,
    schema: judgeSchema(input.kind),
    system: prompts.judge.buildSystem(input.kind),
    prompt: prompts.judge.buildUser(input),
    model: opts.model,
  });
  const names = rubricItems[input.kind];
  const scores = Object.fromEntries(names.scores.map((name) => [name, data[name] as 0 | 1 | 2]));
  const checks = Object.fromEntries(names.checks.map((name) => [name, data[name] === true]));
  return {
    result: { kind: input.kind, scores, checks, passed: judgePassed({ kind: input.kind, scores, checks }, true) },
    usage,
  };
}
