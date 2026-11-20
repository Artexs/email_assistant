import { type CliDescription, isLlmRole, type LlmRole, llmRoles, UsageError } from "@ea/core";
import { z } from "zod";

import { type LlmCall, type LlmProviderId, llmProviderIds } from "../platform/llm";

import { parseFlags } from "./lib/parse-flags";

export const usage = `bun run llm:check [--role ${llmRoles.join("|")}|all] [--provider ${llmProviderIds.join("|")}] [--delegates]`;

export const cliDescriptions = [
  {
    name: "llm:check",
    summary: "Sends one small test call per role to the LLM provider and prints the latency and the token counts.",
    risk: "cost",
    needs: ["llm"],
    usage,
    exits: {
      1: "a key or an own-endpoint model is missing, or a call failed",
      3: "the LLM provider did not answer in time or was overloaded",
    },
    outputNote: "role, provider, model, endpoint host, latency and token counts; never a key or model text",
  },
] satisfies readonly CliDescription[];

export interface LlmCheckArgs {
  /** `all` checks every role in one run. */
  role: LlmRole | "all";
  provider: LlmProviderId | undefined;
  delegates: boolean;
}

// Throws `UsageError` on any bad argument. --delegates belongs to the classifier's triage check only (not to `--role all`).
export function parseLlmCheckArgs(argv: string[]): LlmCheckArgs {
  const { values } = parseFlags({
    args: argv,
    options: { role: { type: "string" }, provider: { type: "string" }, delegates: { type: "boolean" } },
    allowPositionals: false,
  });

  const role = values.role ?? "classifier";
  if (role !== "all" && !isLlmRole(role)) throw new UsageError("--role is not a known role");

  let provider: LlmProviderId | undefined;
  if (values.provider !== undefined) {
    provider = llmProviderIds.find((candidate) => candidate === values.provider);
    if (provider === undefined) throw new UsageError("--provider is not a known provider");
  }

  const delegates = values.delegates === true;
  if (delegates && role !== "classifier") throw new UsageError("--delegates needs --role classifier");
  return { role, provider, delegates };
}

export const greetingSchema = z.object({ greeting: z.string() });

// A check prompt, not a registry prompt: version `<role>-v0`; llm:check writes no DB row.
export function greetingCall<R extends LlmRole>(role: R): LlmCall<{ greeting: string }, R> {
  return {
    role,
    promptVersion: `${role}-v0`,
    schema: greetingSchema,
    system: "Answer with a JSON object.",
    prompt: "Say hello in the field greeting.",
  };
}
