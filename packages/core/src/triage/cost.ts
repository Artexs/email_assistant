export interface LlmPrice {
  inputPerM: number;
  outputPerM: number;
  // First day (UTC, YYYY-MM-DD) of this price. No `from` = valid from the start.
  from?: string;
  source: string;
  checked: string;
}

const PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";

// Paid-tier prices per 1M tokens in USD. The pilot runs on the free tier; these show what billing would cost.
export const llmPrices: Record<string, LlmPrice[]> = {
  "gemini-3.8-flash": [
    { inputPerM: 0.75, outputPerM: 3.75, source: PRICING_URL, checked: "2026-11-05" },
    { inputPerM: 1.5, outputPerM: 7.5, from: "2027-01-01", source: PRICING_URL, checked: "2026-11-05" },
  ],
  "gemini-3.5-flash-lite": [{ inputPerM: 0.3, outputPerM: 2.5, source: PRICING_URL, checked: "2026-11-05" }],
};

const DAYS_PER_MONTH = 30;

// Mail volume that cost reports assume when no real rate is known.
export const DEFAULT_MAILS_PER_DAY = 200;

export function costPerMail(model: string, tokensIn: number, tokensOut: number, at: Date): number | null {
  const prices = Object.hasOwn(llmPrices, model) ? llmPrices[model] : undefined;
  if (!prices) return null;
  let current: LlmPrice | null = null;
  for (const price of prices) {
    const start = price.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(`${price.from}T00:00:00Z`);
    const currentStart =
      current === null || current.from === undefined
        ? Number.NEGATIVE_INFINITY
        : Date.parse(`${current.from}T00:00:00Z`);
    if (start <= at.getTime() && (current === null || start >= currentStart)) current = price;
  }
  if (!current) return null;
  return (tokensIn * current.inputPerM + tokensOut * current.outputPerM) / 1_000_000;
}

export function monthlyCost(avgCostPerMail: number, mailsPerDay: number): number {
  return avgCostPerMail * mailsPerDay * DAYS_PER_MONTH;
}
