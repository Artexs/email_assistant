import type { GenerateFn } from "../client";
import type { LlmConfigError, LlmHardError, LlmSoftError } from "../errors";

import { geminiProvider } from "./gemini";

export interface LlmProvider {
  /** Name in log texts, for example "Gemini". */
  readonly label: string;
  /** Text of the config-error log line. */
  readonly configHint: string;
  createGenerate(opts: { apiKey: string; reasoningEffort: string | null }): GenerateFn;
  classifyError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError;
}

export const llmProviders = { gemini: geminiProvider } satisfies Record<string, LlmProvider>;

export type LlmProviderId = keyof typeof llmProviders;

export const llmProviderIds = Object.keys(llmProviders) as [LlmProviderId, ...LlmProviderId[]];
