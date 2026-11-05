import { z } from "zod";

import { describeError } from "../platform/errors";
import { createLlmClient } from "../platform/llm";
import { createLog } from "../platform/log";

const log = createLog("gemini-check");

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey || !model) {
    log.error("Missing GEMINI_API_KEY or GEMINI_MODEL in .env");
    process.exit(1);
  }

  const llm = createLlmClient({ apiKey, classifierModel: model, timeoutMs: 30_000, rpm: 12 });
  const { data, usage } = await llm.classify({
    schema: z.object({ greeting: z.string() }),
    system: "Answer with a JSON object.",
    prompt: "Say hello in the field greeting.",
  });

  log.info(`model=${usage.model} latencyMs=${usage.latencyMs} tokensIn=${usage.tokensIn} tokensOut=${usage.tokensOut}`);
  log.info(data.greeting);
}

main().catch((error) => {
  log.error(`Request failed: ${describeError(error)}`);
  process.exit(1);
});
