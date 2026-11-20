import type { z } from "zod";

import type { LlmProviderSettings } from "../settings";

/** The config values a provider row reads: the parsed env. A row narrows it to its own keys. */
export type LlmEnv = Readonly<Record<string, unknown>>;

/** The values of the three keys every row has: `<P>_API_KEY`, `<P>_TIMEOUT_MS`, `<P>_RPM`. */
export type CommonEnv<P extends string> = Partial<Record<`${P}_API_KEY`, string | undefined>> &
  Record<`${P}_TIMEOUT_MS` | `${P}_RPM`, number>;

/** The settings of one row: what the role table needs, plus the row's timeout and its own model. */
export interface LlmRowSettings extends LlmProviderSettings {
  /** The call timeout of a role that sets none of its own. */
  timeoutMs: number;
  /** The one model of an own endpoint; null: the row has none set. */
  ownModel: string | null;
}

/** The key, timeout and rate of one row, read through its prefix. */
export function commonSettings<P extends string>(
  prefix: P,
  env: CommonEnv<P>
): Pick<LlmRowSettings, "apiKeyName" | "apiKey" | "timeoutMs" | "rpm"> {
  const values = env as Readonly<Record<string, string | number | undefined>>;
  return {
    apiKeyName: `${prefix}_API_KEY`,
    apiKey: values[`${prefix}_API_KEY`] as string | undefined,
    timeoutMs: values[`${prefix}_TIMEOUT_MS`] as number,
    rpm: values[`${prefix}_RPM`] as number,
  };
}

/** The extra env keys of a row: a Zod shape. A row with none passes `{}`. */
export type LlmEnvShape = Record<string, z.ZodType>;
