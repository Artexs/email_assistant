/**
 * Where an LLM call runs. `standard`: the default API of the provider; `eu`: the OpenAI Europe endpoint;
 * `own`: an OpenAI-compatible server that the operator runs.
 */
export type LlmEndpointKind = "standard" | "eu" | "own";

export interface LlmPrice {
  inputPerM: number;
  // The price of cached input tokens, for the record. `costPerMail` does not use it: a usage holds no cached count,
  // so every input token is charged at `inputPerM` (an upper bound).
  cachedInputPerM?: number;
  outputPerM: number;
  // First day (UTC, YYYY-MM-DD) of this price. No `from` = valid from the start.
  from?: string;
  // Only `eu` rows have this field. No field = the standard endpoint.
  endpoint?: "eu";
  // True when the source is not the vendor price page. A report prints this.
  unverified?: true;
  source: string;
  checked: string;
}

const PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";

// Paid prices per 1M tokens in USD. The Gemini pilot runs on the free tier; OpenAI has no free tier.
export const llmPrices: Record<string, LlmPrice[]> = {
  "gemini-3.8-flash": [
    { inputPerM: 0.75, outputPerM: 3.75, source: PRICING_URL, checked: "2026-11-05" },
    { inputPerM: 1.5, outputPerM: 7.5, from: "2027-01-01", source: PRICING_URL, checked: "2026-11-05" },
  ],
  "gemini-3.5-flash-lite": [{ inputPerM: 0.3, outputPerM: 2.5, source: PRICING_URL, checked: "2026-11-05" }],
  "gpt-6-luna": [
    { inputPerM: 0.1, outputPerM: 0.5, source: OPENAI_PRICING_URL, checked: "2026-11-06" },
    // UNVERIFIED: a secondary source (+10% over the standard price), not the OpenAI price page.
    // A later row replaces this one with the price that OpenAI shows for the EU project.
    {
      inputPerM: 0.11,
      outputPerM: 0.55,
      endpoint: "eu",
      unverified: true,
      source: "E11 discovery notes §6 (opsware.co 2026-10-16, secondary)",
      checked: "2026-11-13",
    },
  ],
  // Read on the OpenAI price page, standard tier, 2026-11-15 (the model of the cascade eval, which did not ship; the price row stays as data).
  "gpt-6.1-terra": [
    { inputPerM: 1, cachedInputPerM: 0.05, outputPerM: 5, source: OPENAI_PRICING_URL, checked: "2026-11-15" },
  ],
};

const DAYS_PER_MONTH = 30;

// Mail volume that cost reports assume when no real rate is known.
export const DEFAULT_MAILS_PER_DAY = 200;

const ENDPOINT_KINDS: readonly string[] = ["standard", "eu", "own"];

/**
 * Reads the `endpoint` key of an `llm.call` row. A row written before the endpoint was logged has none: it ran on `standard`.
 * Any other value reads `standard` too: the dearest rate, so a damaged row never makes a call cheaper.
 */
export function toEndpointKind(value: unknown): LlmEndpointKind {
  return typeof value === "string" && ENDPOINT_KINDS.includes(value) ? (value as LlmEndpointKind) : "standard";
}

/**
 * The price row that is valid at `at` for the endpoint: `eu` takes only `eu` rows, `standard` only rows without
 * `endpoint`. An `own` server has no price row (its cost is 0). Null when no row applies.
 */
export function priceRowFor(model: string, at: Date, endpoint: LlmEndpointKind = "standard"): LlmPrice | null {
  if (endpoint === "own") return null;
  const prices = Object.hasOwn(llmPrices, model) ? llmPrices[model] : undefined;
  if (!prices) return null;
  let current: LlmPrice | null = null;
  for (const price of prices) {
    if ((price.endpoint ?? "standard") !== endpoint) continue;
    const start = price.from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(`${price.from}T00:00:00Z`);
    const currentStart =
      current === null || current.from === undefined
        ? Number.NEGATIVE_INFINITY
        : Date.parse(`${current.from}T00:00:00Z`);
    if (start <= at.getTime() && (current === null || start >= currentStart)) current = price;
  }
  return current;
}

/**
 * The USD cost of the tokens. An `own` endpoint costs 0, also for a model without a price row: the operator
 * runs the server. Null when the model has no price row for the endpoint (the call is unpriced).
 */
export function costPerMail(
  model: string,
  tokensIn: number,
  tokensOut: number,
  at: Date,
  endpoint: LlmEndpointKind = "standard"
): number | null {
  if (endpoint === "own") return 0;
  const current = priceRowFor(model, at, endpoint);
  if (!current) return null;
  return (tokensIn * current.inputPerM + tokensOut * current.outputPerM) / 1_000_000;
}

export function monthlyCost(avgCostPerMail: number, mailsPerDay: number): number {
  return avgCostPerMail * mailsPerDay * DAYS_PER_MONTH;
}
