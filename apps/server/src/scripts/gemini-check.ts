import { GoogleGenAI } from "@google/genai";

import { createLog } from "../platform/log";

const log = createLog("gemini-check");

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey || !model) {
    log.error("Missing GEMINI_API_KEY or GEMINI_MODEL in .env");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({ model, contents: "Say hello" });

  log.info(`model=${model}`);
  log.info(res.text);
}

main().catch((error) => {
  log.error("Request failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
