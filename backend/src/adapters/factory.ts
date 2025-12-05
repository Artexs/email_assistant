import { gmail_v1 } from "googleapis";

import { IDatabaseProvider } from "./interfaces/database.interface";
import { IEmailProvider } from "./interfaces/email.interface";
import { ILLMProvider } from "./interfaces/llm.interface";
import { GmailAdapter } from "./providers/gmail.provider";
import { OpenAIAdapter } from "./providers/openai.provider";
import { SupabaseAdapter } from "./providers/supabase.provider";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class IntegrationFactory {
  static createLLMProvider(type: "OPENAI", config: { apiKey: string; model?: string }): ILLMProvider {
    if (type === "OPENAI") {
      return new OpenAIAdapter(config.apiKey, config.model);
    }
    throw new Error(`Unsupported LLM provider type: ${type}`);
  }

  static createEmailProvider(
    type: "GMAIL",
    config: { auth: gmail_v1.Params$Resource$Users$Messages$List["auth"] }
  ): IEmailProvider {
    if (type === "GMAIL") {
      return new GmailAdapter(config.auth);
    }
    throw new Error(`Unsupported Email provider type: ${type}`);
  }

  static createDatabaseProvider(type: "SUPABASE", config: { url: string; key: string }): IDatabaseProvider {
    if (type === "SUPABASE") {
      return new SupabaseAdapter(config.url, config.key);
    }
    throw new Error(`Unsupported Database provider type: ${type}`);
  }
}
