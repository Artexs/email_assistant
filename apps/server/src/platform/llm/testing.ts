import { createLlmClient, type GenerateFn, type LlmClient } from "./client";
import { type LlmProviderId, llmProviders } from "./providers";
import { uniformRoleTable } from "./settings";

/**
 * Tests only: a client whose every role calls `generate` on one provider row. The provider's own error rules apply.
 * Production code builds the client from `llmRoleTable(config)`.
 */
export function createFixedLlmClient(
  generate: GenerateFn,
  opts: {
    provider?: LlmProviderId;
    model: string;
    /** The key the provider row holds; a log test passes its marker here. */
    apiKey?: string;
    timeoutMs?: number;
    rpm?: number;
    reasoningEffort?: string | null;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }
): LlmClient {
  const provider = opts.provider ?? "gemini";
  return createLlmClient({
    table: uniformRoleTable(
      {
        provider,
        model: opts.model,
        timeoutMs: opts.timeoutMs ?? 1000,
        rpm: null,
        reasoningEffort: opts.reasoningEffort ?? null,
      },
      { apiKeyName: "TEST_API_KEY", apiKey: opts.apiKey ?? "MARKER-KEY", rpm: opts.rpm ?? 60_000 }
    ),
    providers: { [provider]: { createGenerate: () => generate, classifyError: llmProviders[provider].classifyError } },
    now: opts.now,
    sleep: opts.sleep,
  });
}
