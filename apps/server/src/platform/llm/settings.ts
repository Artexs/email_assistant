import { type LlmEndpointKind, type LlmProviderId, llmProviderIds, type LlmRole } from "@ea/core";

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
  /** Env key name, for messages, for example the key of a registry row. */
  apiKeyName: string;
  /** Secret: never print or log it. */
  apiKey: string | undefined;
  /** Calls per minute of all roles on this provider, in this process. */
  rpm: number;
  /** The base URL the adapter passes to its SDK; null: the SDK default (Gemini). */
  baseUrl: string | null;
  /** Where the calls of this provider run; Gemini: `standard`. */
  endpoint: LlmEndpointKind;
}

export interface LlmRoleTable {
  roles: Record<LlmRole, LlmRoleSettings>;
  providers: Record<LlmProviderId, LlmProviderSettings>;
}

/** Tests and one-provider tools: every role gets the same row; every provider row is the same. */
export function uniformRoleTable(row: LlmRoleSettings, provider: LlmProviderSettings): LlmRoleTable {
  return {
    roles: { classifier: row, judge: row, drafter: row, extractor: row, stylist: row },
    providers: Object.fromEntries(llmProviderIds.map((id) => [id, provider])) as Record<
      LlmProviderId,
      LlmProviderSettings
    >,
  };
}

/**
 * The endpoint of one role for logs and `llm:check`: the kind and the hostname only. Never the URL: it has a path
 * and a port, and a bad config may have held user info.
 */
export function llmEndpointFields(
  table: LlmRoleTable,
  role: LlmRole
): { provider: LlmProviderId; model: string; endpoint: LlmEndpointKind; host: string | null } {
  const row = table.roles[role];
  const provider = table.providers[row.provider];
  const host = provider.baseUrl === null ? null : new URL(provider.baseUrl).hostname.replace(/^\[|\]$/g, "");
  return { provider: row.provider, model: row.model, endpoint: provider.endpoint, host };
}
