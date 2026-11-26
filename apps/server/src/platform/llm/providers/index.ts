import type { LlmEndpointKind, LlmProviderId } from "@ea/core";
import type { z } from "zod";

import type { GenerateFn } from "../client";
import type { LlmConfigError, LlmHardError, LlmSoftError } from "../errors";

import { deepseekProvider } from "./deepseek";
import { type LlmEnv, type LlmEnvShape, type LlmRowSettings } from "./env";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";

// The ids come from the catalog in `@ea/core`: a catalog row without a row here fails the typecheck.
export { type LlmProviderId, llmProviderIds } from "@ea/core";
export type { LlmEnv, LlmRowSettings } from "./env";

export interface LlmProvider {
  /** The start of the provider's env keys: `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM` (for example "OPENAI"). */
  readonly envPrefix: string;
  /** The values of `<P>_TIMEOUT_MS` and `<P>_RPM` when the key is empty. */
  readonly defaults: { readonly timeoutMs: number; readonly rpm: number };
  /**
   * true: the sub-processor registry has a row for the provider (a test ties the two). false: the provider has no row, so
   * config refuses real mail for it (`TRIAGE_LLM_SCOPE=all`) outside the sim stack.
   */
  readonly realMail: boolean;
  /** Env keys that older releases read (a model or an effort). A non-empty value stops config: the tiers decide now. */
  readonly removedEnvKeys: readonly string[];
  /** The extra env keys of the row, as a Zod shape; config spreads the shapes of all rows. `{}` when it has none. */
  readonly envShape: LlmEnvShape;
  /** The env key of the one model of an own endpoint; null: the row has no own endpoint. */
  readonly ownModelKey: string | null;
  /** The checks of the row that always run (also with `TRIAGE_LLM_SCOPE=off`). The messages name keys, never values. */
  check(config: LlmEnv, ctx: z.RefinementCtx): void;
  /** The key, rate, timeout, endpoint and own model of the row. It throws a `ConfigError` for a bad endpoint value. */
  settings(config: LlmEnv): LlmRowSettings;
  createGenerate(opts: {
    apiKey: string;
    reasoningEffort: string | null;
    baseUrl: string | null;
    endpoint: LlmEndpointKind;
  }): GenerateFn;
  classifyError(error: unknown, model: string): LlmSoftError | LlmConfigError | LlmHardError;
}

/** The provider when `LLM_PROVIDER` is not set. */
export const defaultLlmProviderId: LlmProviderId = "openai";

export const llmProviders = {
  gemini: geminiProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
} satisfies Record<LlmProviderId, LlmProvider>;
