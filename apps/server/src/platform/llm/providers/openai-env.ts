import { z } from "zod";

import { ConfigError, emptyAsUndefined } from "../../config-shared";

import { DEFAULT_OPENAI_BASE_URL, parseLlmBaseUrl } from "./endpoint";
import { type CommonEnv, type LlmRowSettings, commonSettings } from "./env";

/** The key an own server gets when `OPENAI_OWN_API_KEY` is not set. The SDK needs some key; Ollama ignores it. */
const OWN_DUMMY_API_KEY = "own";

/** The extra env keys of the openai row (the endpoint and the own server). */
export const openaiEnvShape = {
  // The key an own server gets, when it needs one. Secret: never print or log it. Empty = the fixed dummy key.
  // An own endpoint never gets OPENAI_API_KEY: that key belongs to OpenAI.
  OPENAI_OWN_API_KEY: z.preprocess(emptyAsUndefined, z.string().optional()),
  // The one model of an own endpoint: every role on openai uses it. Read only when the endpoint is own. Empty = not set.
  OPENAI_OWN_MODEL: z.preprocess(emptyAsUndefined, z.string().optional()),
  // The endpoint of the openai provider; `parseLlmBaseUrl` checks it. Empty = the default.
  OPENAI_BASE_URL: z.preprocess(emptyAsUndefined, z.string().default(DEFAULT_OPENAI_BASE_URL)),
  // "own" = the URL is a server the operator runs (any host over https). The only value.
  OPENAI_ENDPOINT_KIND: z.preprocess(emptyAsUndefined, z.literal("own").optional()),
};

type OpenAiEnv = CommonEnv<"OPENAI"> & z.infer<z.ZodObject<typeof openaiEnvShape>> & { LLM_PROVIDER: string };

/** The check of `OPENAI_BASE_URL`, also with `TRIAGE_LLM_SCOPE=off`, and the own-model rule. Messages name keys, never values. */
export function checkOpenAiEnv(config: OpenAiEnv, ctx: z.RefinementCtx): void {
  const parsed = parseLlmBaseUrl(config.OPENAI_BASE_URL, config.OPENAI_ENDPOINT_KIND === "own");
  if ("error" in parsed) {
    ctx.addIssue({ code: "custom", path: ["OPENAI_BASE_URL"], message: parsed.error });
    return;
  }
  if (config.LLM_PROVIDER === "openai" && parsed.endpoint === "own" && config.OPENAI_OWN_MODEL === undefined) {
    ctx.addIssue({ code: "custom", path: ["OPENAI_OWN_MODEL"], message: "needed for an own endpoint" });
  }
}

/**
 * The settings of the openai row. An own endpoint never gets the OpenAI key: the row holds the own key or the dummy,
 * so the start needs no `OPENAI_API_KEY` and the key can reach no other host. `loadConfig` has checked the URL, so a
 * bad value here throws a `ConfigError`.
 */
export function openAiSettings(config: OpenAiEnv): LlmRowSettings {
  const parsed = parseLlmBaseUrl(config.OPENAI_BASE_URL, config.OPENAI_ENDPOINT_KIND === "own");
  if ("error" in parsed) throw new ConfigError(["OPENAI_BASE_URL"]);
  const common = commonSettings("OPENAI", config);
  const own = parsed.endpoint === "own";
  return {
    ...common,
    apiKeyName: own ? "OPENAI_OWN_API_KEY" : common.apiKeyName,
    apiKey: own ? (config.OPENAI_OWN_API_KEY ?? OWN_DUMMY_API_KEY) : common.apiKey,
    baseUrl: parsed.url,
    endpoint: parsed.endpoint,
    ownModel: config.OPENAI_OWN_MODEL ?? null,
  };
}
