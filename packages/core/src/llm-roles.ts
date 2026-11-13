// The LLM roles. Every LLM call names one; the role table in the server config decides its provider and model.
// Rules: docs/code-patterns.md § Side effects ("An LLM call names a role").
export const llmRoles = ["classifier", "judge", "drafter", "extractor", "escalation"] as const;

export type LlmRole = (typeof llmRoles)[number];

/** A prompt version starts with its role: `classifier-v2`. */
export type PromptVersion<R extends LlmRole = LlmRole> = `${R}-v${number}`;

export function isLlmRole(value: string): value is LlmRole {
  return (llmRoles as readonly string[]).includes(value);
}
