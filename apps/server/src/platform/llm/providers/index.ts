import type { LlmEndpointKind, LlmProviderId } from "@ea/core";

import type { GenerateFn } from "../client";
import type { LlmConfigError, LlmHardError, LlmSoftError } from "../errors";

import { deepseekProvider } from "./deepseek";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";

// The ids come from the catalog in `@ea/core`: a catalog row without a row here fails the typecheck.
export { type LlmProviderId, llmProviderIds } from "@ea/core";

export interface LlmProvider {
  /** The start of the provider's env keys: `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM` (for example "OPENAI"). */
  readonly envPrefix: string;
  /** The values of `<P>_TIMEOUT_MS` and `<P>_RPM` when the key is empty. */
  readonly defaults: { readonly timeoutMs: number; readonly rpm: number };
  /**
   * false: the provider has no sub-processor row, so config refuses real mail for it (`TRIAGE_LLM_SCOPE=all`) outside
   * the sim stack.
   */
  readonly realMail: boolean;
  /** Env keys that older releases read (a model or an effort). A non-empty value stops config: the tiers decide now. */
  readonly removedEnvKeys: readonly string[];
  createGenerate(opts: {
    apiKey: string;
    reasoningEffort: string | null;
    baseUrl: string | null;
    endpoint: LlmEndpointKind;
  }): GenerateFn;
  classifyError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError;
}

export const llmProviders = {
  gemini: geminiProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
} satisfies Record<LlmProviderId, LlmProvider>;
