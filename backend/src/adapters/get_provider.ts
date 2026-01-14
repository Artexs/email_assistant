import { IDatabaseProvider } from "./interfaces/database.interface";
import { IEmailProvider } from "./interfaces/email.interface";
import { ILLMProvider } from "./interfaces/llm.interface";
import { ImapEmailProvider, ImapConfig } from "./providers/email.provider";
import { OpenAIAdapter } from "./providers/openai.provider";
import { SupabaseAdapter } from "./providers/supabase.provider";

export type EmailProviderType = "GMAIL" | "INTERIA";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Providers {
  static getLLM(apiKey: string, model?: string): ILLMProvider {
    return new OpenAIAdapter(apiKey, model);
  }

  static getEmail(type: EmailProviderType, email: string, password: string): IEmailProvider {
    const config = getEmailConfig(type, email, password);
    return new ImapEmailProvider(config);
  }

  static getDatabase(url: string, key: string): IDatabaseProvider {
    return new SupabaseAdapter(url, key);
  }
}

const getEmailConfig = (type: EmailProviderType, email: string, password: string): ImapConfig => {
  switch (type) {
    case "INTERIA":
      return {
        user: email,
        password: password,
        host: "poczta.interia.pl",
        port: 993,
        secure: true,
        tls: { rejectUnauthorized: false },
      };
    case "GMAIL":
      return {
        user: email,
        password: password,
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        tls: { rejectUnauthorized: true },
      };
    default:
      throw new Error(`Unsupported email provider type: ${type}`);
  }
};
