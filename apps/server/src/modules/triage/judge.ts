import type { LlmClient, LlmUsage } from "../../platform/llm";

import { type JudgePrompt, prompts } from "./prompts";
import type { RubricKind } from "./prompts/judge-v1";
import { STYLE_SCORE } from "./prompts/judge-v4";

export interface JudgeResult {
  kind: RubricKind;
  scores: Record<string, 0 | 1 | 2>;
  checks: Record<string, boolean>;
  passed: boolean;
}

// The draft passes when every check is true, every score is at least 1 and the code checks passed. The style score of
// judge-v4 is a measure, not a bar: it does not decide.
export function judgePassed(result: Omit<JudgeResult, "passed">, codeChecksPassed: boolean): boolean {
  return (
    codeChecksPassed &&
    Object.values(result.checks).every((value) => value) &&
    Object.entries(result.scores).every(([name, value]) => name === STYLE_SCORE || value >= 1)
  );
}

// One LLM call per draft. LLM errors go to the caller unchanged. The answer has no free text.
// `passed` of the result is the rubric alone: the eval joins it with the code checks (`judgePassed`).
// `prompt` is `prompts.judge` unless the drafter eval picks another version.
export async function judgeDraft(
  llm: LlmClient,
  input: Parameters<JudgePrompt["buildUser"]>[0],
  opts: { model?: string; prompt?: JudgePrompt } = {}
): Promise<{ result: JudgeResult; usage: LlmUsage }> {
  const prompt = opts.prompt ?? prompts.judge;
  const { data, usage } = await llm.generate({
    role: prompt.role,
    promptVersion: prompt.version,
    schema: prompt.answerSchema(input.kind),
    system: prompt.buildSystem(input.kind),
    prompt: prompt.buildUser(input),
    model: opts.model,
  });
  const names = prompt.rubricItems[input.kind];
  const scores = Object.fromEntries(names.scores.map((name) => [name, data[name] as 0 | 1 | 2]));
  const checks = Object.fromEntries(names.checks.map((name) => [name, data[name] === true]));
  return {
    result: { kind: input.kind, scores, checks, passed: judgePassed({ kind: input.kind, scores, checks }, true) },
    usage,
  };
}
