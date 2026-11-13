import type { LlmRole } from "@ea/core";

import type { LlmProviderId } from "./providers";

/** One row of the role table: where the calls of one role go. */
export interface LlmRoleSettings {
  provider: LlmProviderId;
  model: string;
  timeoutMs: number;
  /** The role's own calls per minute; null: only the provider limit applies. */
  rpm: number | null;
  /** null: no effort setting is sent (Gemini, or OpenAI without one). */
  reasoningEffort: string | null;
}

export interface LlmProviderSettings {
  /** Env key name, for messages: "GEMINI_API_KEY". */
  apiKeyName: string;
  /** Secret: never print or log it. */
  apiKey: string | undefined;
  /** Calls per minute of all roles on this provider, in this process. */
  rpm: number;
}

export interface LlmRoleTable {
  roles: Record<LlmRole, LlmRoleSettings>;
  providers: Record<LlmProviderId, LlmProviderSettings>;
}

/** Tests and one-provider tools: every role gets the same row; both provider rows are the same. */
export function uniformRoleTable(row: LlmRoleSettings, provider: LlmProviderSettings): LlmRoleTable {
  return {
    roles: { classifier: row, judge: row, drafter: row, extractor: row, escalation: row },
    providers: { gemini: provider, openai: provider },
  };
}
