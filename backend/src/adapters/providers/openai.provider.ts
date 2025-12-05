import OpenAI from "openai";

import { log } from "../../utils/log";
import { ILLMProvider } from "../interfaces/llm.interface";

export class OpenAIAdapter implements ILLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-5-nano") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateResponse(prompt: string): Promise<string> {
    try {
      const completion = await this.client.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: this.model,
      });

      return completion.choices[0].message.content || "";
    } catch (error) {
      log.error("Error generating response from OpenAI:", error);
      throw error;
    }
  }
}
