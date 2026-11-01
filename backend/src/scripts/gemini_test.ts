import path from "path";

import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

import { log } from "../utils/log";

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey || !model) {
    log.error("Missing GEMINI_API_KEY or GEMINI_MODEL in backend/.env");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({ model, contents: "Say hello" });

  log.info(`[gemini_test] model=${model}`);
  log.info(res.text);
}

main().catch((error) => {
  log.error("[gemini_test] Request failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
