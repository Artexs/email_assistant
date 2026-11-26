import type { GenerateFn } from "../client";

import { DEEPSEEK_BASE_URL } from "./deepseek-host";
import { type CommonEnv, commonSettings, type LlmRowSettings } from "./env";
import { classifyOpenAiError, createOpenAiGenerate, type OpenAiLike, toStrictJsonSchema } from "./openai";
import type { openAiClientOptions } from "./openai";

import type { LlmProvider } from "./index";

// DeepSeek speaks the Responses API with strict `json_schema` like OpenAI, so this row reuses the OpenAI adapter.
// The host is fixed (`deepseek-host.ts`): no env key moves it, so the DeepSeek key can reach no other host.
export { DEEPSEEK_BASE_URL };

// The `format` values that the DeepSeek schema check accepts. Measured 2026-11-26: `date` gets a 400 that lists these.
const DEEPSEEK_FORMATS: ReadonlySet<string> = new Set(["email", "hostname", "ipv4", "ipv6", "uuid"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The JSON Schema in the form that DeepSeek accepts, with the same meaning. DeepSeek refuses two shapes that OpenAI
 * takes (measured 2026-11-26, HTTP 400 `Invalid json schema`): an `anyOf` branch that is only another `anyOf` (a
 * nullable discriminated union in the strict form), and a `format` outside its list. The branches of the inner
 * `anyOf` move up; a format outside the list goes, and the `pattern` next to it still holds the rule. The output
 * check is Zod after the call, so a dropped format changes no accepted answer.
 */
export function toDeepseekJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toDeepseekJsonSchema);
  if (!isPlainObject(node)) return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    // `properties` and `$defs` map names to schemas: a property may have the name of a keyword.
    copy[key] =
      (key === "properties" || key === "$defs") && isPlainObject(value)
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toDeepseekJsonSchema(child)]))
        : toDeepseekJsonSchema(value);
  }
  if (typeof copy.format === "string" && !DEEPSEEK_FORMATS.has(copy.format)) delete copy.format;
  if (Array.isArray(copy.anyOf)) {
    copy.anyOf = copy.anyOf.flatMap((branch: unknown) =>
      isPlainObject(branch) && Object.keys(branch).length === 1 && Array.isArray(branch.anyOf) ? branch.anyOf : [branch]
    );
  }
  return copy;
}

/** The role's effort goes into `reasoning.effort` as it is: DeepSeek takes none, low, high and max. */
export function createDeepseekGenerate(opts: {
  apiKey: string;
  reasoningEffort: string | null;
  /** Tests only: makes the client from the SDK options. */
  newClient?: (options: ReturnType<typeof openAiClientOptions>) => OpenAiLike;
}): GenerateFn {
  const generate = createOpenAiGenerate({
    apiKey: opts.apiKey,
    reasoningEffort: opts.reasoningEffort,
    baseUrl: DEEPSEEK_BASE_URL,
    endpoint: "standard",
    newClient: opts.newClient,
  });
  // The strict form first: it turns the `oneOf` of a discriminated union into `anyOf`, and a second strict pass in the
  // OpenAI adapter changes nothing.
  return (req) => generate({ ...req, jsonSchema: toDeepseekJsonSchema(toStrictJsonSchema(req.jsonSchema, req.model)) });
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
