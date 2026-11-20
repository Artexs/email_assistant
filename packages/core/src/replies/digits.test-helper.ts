import { checkReplyBody, type ReplyCheckCode } from "./index";

export function failuresOf(body: string, allowed: string[] = [], quoted: string[] = []): ReplyCheckCode[] {
  const result = checkReplyBody(body, { language: "pl", allowed, quoted });
  return result.ok ? [] : result.failures;
}

export const say = (text: string): string => `Dzień dobry, ${text} dziękuję bardzo.`;
