import { createLlmClient, type GenerateFn, type LlmClient } from "./client";
import { type LlmProviderId, llmProviderIds, llmProviders } from "./providers";
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
  const provider = opts.provider ?? llmProviderIds[0];
  return createLlmClient({
    table: uniformRoleTable(
      {
        provider,
        model: opts.model,
        timeoutMs: opts.timeoutMs ?? 1000,
        rpm: null,
        reasoningEffort: opts.reasoningEffort ?? null,
      },
      {
        apiKeyName: "TEST_API_KEY",
        apiKey: opts.apiKey ?? "MARKER-KEY",
        // eslint-disable-next-line ea/no-time-literals -- a requests-per-minute count (a limit nobody reaches), not a time
        rpm: opts.rpm ?? 60_000,
        baseUrl: null,
        endpoint: "standard",
      }
    ),
    providers: { [provider]: { createGenerate: () => generate, classifyError: llmProviders[provider].classifyError } },
    now: opts.now,
    sleep: opts.sleep,
  });
}
