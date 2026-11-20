/**
 * The fixed endpoint of the DeepSeek row. It lives in its own file so that `endpoint.ts` can refuse the host without
 * importing the adapter (the OpenAI adapter imports `endpoint.ts`). No env key moves it, so the DeepSeek key can reach no other host.
 */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** The lower-case hostname of `DEEPSEEK_BASE_URL`. */
export const DEEPSEEK_HOST = new URL(DEEPSEEK_BASE_URL).hostname;
