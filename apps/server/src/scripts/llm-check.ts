import { parseArgs } from "node:util";

import { classifierCategories } from "@ea/core";
import { z } from "zod";

import { type ClassifierEmail, classifyEmail } from "../modules/triage";
import { llmSettings, loadConfig } from "../platform/config";
import { describeError } from "../platform/errors";
import { createLlmClient, type LlmProviderId, llmProviderIds, type LlmUsage } from "../platform/llm";
import { createLog } from "../platform/log";

const log = createLog("llm-check");

const usage = `usage: bun run llm:check [--provider ${llmProviderIds.join("|")}]`;

// Made-up mail: example.com addresses, no real data.
const SAMPLE_EMAIL: ClassifierEmail = {
  from: "anna.nowak@example.com",
  to: ["manager@example.com"],
  cc: [],
  subject: "Meeting on Thursday?",
  receivedAt: new Date("2026-01-12T09:00:00Z"),
  bodyText: "Hi, can we meet on Thursday at 10:00 to talk about the Q1 plan? Please confirm. Anna",
  thread: [],
};

function readProvider(): LlmProviderId | undefined {
  let value: string | undefined;
  try {
    value = parseArgs({ args: process.argv.slice(2), options: { provider: { type: "string" } }, strict: true }).values
      .provider;
  } catch {
    log.error(usage);
    process.exit(1);
  }
  if (value === undefined) return undefined;
  const id = llmProviderIds.find((candidate) => candidate === value);
  if (id === undefined) {
    log.error(usage);
    process.exit(1);
  }
  return id;
}

async function main() {
  const config = loadConfig();
  const settings = llmSettings(config, readProvider() ?? config.LLM_PROVIDER);

  if (settings.apiKey === undefined) {
    log.error(`${settings.apiKeyName} is missing`);
    process.exit(1);
  }

  const llm = createLlmClient({
    provider: settings.provider,
    apiKey: settings.apiKey,
    classifierModel: settings.classifierModel,
    timeoutMs: settings.timeoutMs,
    rpm: settings.rpm,
    reasoningEffort: settings.reasoningEffort,
  });

  const line = (check: string, used: LlmUsage, extra = "") =>
    log.info(
      `provider=${settings.provider} model=${used.model} effort=${settings.reasoningEffort ?? "-"} check=${check} latencyMs=${used.latencyMs} tokensIn=${used.tokensIn} tokensOut=${used.tokensOut}${extra}`
    );

  const greeting = await llm.classify({
    schema: z.object({ greeting: z.string() }),
    system: "Answer with a JSON object.",
    prompt: "Say hello in the field greeting.",
  });
  line("greeting", greeting.usage);

  const triage = await classifyEmail(llm, {
    email: SAMPLE_EMAIL,
    sender: { whitelisted: false, vip: false, noreply: false },
    allowed: classifierCategories,
  });
  line("triage", triage.usage, ` category=${triage.analysis.category}`);
}

main().catch((error) => {
  log.error(`check failed: ${describeError(error)}`);
  process.exit(1);
});
