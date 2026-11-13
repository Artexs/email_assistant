import { parseArgs } from "node:util";

import { isLlmRole, type LlmRole, llmRoles } from "@ea/core";
import { z } from "zod";

import { type LlmCall, type LlmProviderId, llmProviderIds } from "../platform/llm";

export const usage = `usage: bun run llm:check [--role ${llmRoles.join("|")}] [--provider ${llmProviderIds.join("|")}] [--delegates]`;

export interface LlmCheckArgs {
  role: LlmRole;
  provider: LlmProviderId | undefined;
  delegates: boolean;
}

// null on any bad argument. --delegates belongs to the classifier's triage check only.
export function parseLlmCheckArgs(argv: string[]): LlmCheckArgs | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { role: { type: "string" }, provider: { type: "string" }, delegates: { type: "boolean" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }

  const role = values.role ?? "classifier";
  if (!isLlmRole(role)) return null;

  let provider: LlmProviderId | undefined;
  if (values.provider !== undefined) {
    provider = llmProviderIds.find((candidate) => candidate === values.provider);
    if (provider === undefined) return null;
  }

  const delegates = values.delegates === true;
  if (delegates && role !== "classifier") return null;
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
