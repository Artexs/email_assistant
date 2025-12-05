export interface ILLMProvider {
  generateResponse(prompt: string): Promise<string>;
}
