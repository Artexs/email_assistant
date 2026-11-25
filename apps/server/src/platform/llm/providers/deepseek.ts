import type { GenerateFn } from "../client";

import { DEEPSEEK_BASE_URL } from "./deepseek-host";
import { type CommonEnv, commonSettings, type LlmRowSettings } from "./env";
import { classifyOpenAiError, createOpenAiGenerate, type OpenAiLike } from "./openai";
import type { openAiClientOptions } from "./openai";

import type { LlmProvider } from "./index";

// DeepSeek speaks the Responses API with strict `json_schema` like OpenAI, so this row reuses the OpenAI adapter.
// The host is fixed (`deepseek-host.ts`): no env key moves it, so the DeepSeek key can reach no other host.
export { DEEPSEEK_BASE_URL };

/** The role's effort goes into `reasoning.effort` as it is: DeepSeek takes none, low, high and max. */
export function createDeepseekGenerate(opts: {
  apiKey: string;
  reasoningEffort: string | null;
  /** Tests only: makes the client from the SDK options. */
  newClient?: (options: ReturnType<typeof openAiClientOptions>) => OpenAiLike;
}): GenerateFn {
  return createOpenAiGenerate({
    apiKey: opts.apiKey,
    reasoningEffort: opts.reasoningEffort,
    baseUrl: DEEPSEEK_BASE_URL,
    endpoint: "standard",
    newClient: opts.newClient,
  });
}

export const deepseekProvider = {
  envPrefix: "DEEPSEEK" as const,
  defaults: { timeoutMs: 30000, rpm: 60 },
  // The sub-processor row `deepseek` lists this provider, so real mail may reach it.
  realMail: true,
  removedEnvKeys: [] as const,
  envShape: {},
  ownModelKey: null,
  check: () => undefined,
  // The host is fixed and the key is its own: no OpenAI value reaches it.
  settings: (config: CommonEnv<"DEEPSEEK">): LlmRowSettings => ({
    ...commonSettings("DEEPSEEK", config),
    baseUrl: DEEPSEEK_BASE_URL,
    endpoint: "standard",
    ownModel: null,
  }),
  createGenerate: (opts) => createDeepseekGenerate(opts),
  classifyError: classifyOpenAiError,
} satisfies LlmProvider;
