import type { LlmRole } from "./llm-roles";
import type { LlmPrice } from "./triage/cost";

/**
 * The provider catalog: pure data. The provider ids, the model of each tier, the price rows and the effort rule live
 * here, so a new provider is one row. The server registry (`platform/llm/providers/`) adds the adapter and the env keys.
 */

/** `light`: the cheap model for classifier, drafter, extractor and stylist. `strong`: the model of the judge. */
export const llmTiers = ["light", "strong"] as const;
export type LlmTier = (typeof llmTiers)[number];

export const llmEffortLevels = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type LlmEffortLevel = (typeof llmEffortLevels)[number];

export interface LlmProviderCatalogRow {
  label: string;
  tiers: Record<LlmTier, { model: string }>;
  /** Paid prices per 1M tokens in USD, by model id. */
  prices: Record<string, LlmPrice[]>;
  /** `levels`: the provider takes the role's level as is. `none`: the provider gets no effort. */
  effort: "levels" | "none";
}

const GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";
const DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/quick_start/pricing";

const openai = {
  label: "OpenAI",
  tiers: { light: { model: "gpt-6-luna" }, strong: { model: "gpt-6.1-terra" } },
  // OpenAI has no free tier.
  prices: {
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
    // Read on the OpenAI price page, standard tier, 2026-11-15.
    "gpt-6.1-terra": [
      { inputPerM: 1, cachedInputPerM: 0.05, outputPerM: 5, source: OPENAI_PRICING_URL, checked: "2026-11-15" },
    ],
  },
  effort: "levels",
} satisfies LlmProviderCatalogRow;

const gemini = {
  label: "Gemini",
  tiers: { light: { model: "gemini-3.5-flash-lite" }, strong: { model: "gemini-3.8-flash" } },
  // The Gemini pilot runs on the free tier; these are the paid prices.
  prices: {
    "gemini-3.8-flash": [
      { inputPerM: 0.75, outputPerM: 3.75, source: GEMINI_PRICING_URL, checked: "2026-11-05" },
      { inputPerM: 1.5, outputPerM: 7.5, from: "2027-01-01", source: GEMINI_PRICING_URL, checked: "2026-11-05" },
    ],
    "gemini-3.5-flash-lite": [{ inputPerM: 0.3, outputPerM: 2.5, source: GEMINI_PRICING_URL, checked: "2026-11-05" }],
  },
  effort: "none",
} satisfies LlmProviderCatalogRow;

// DeepSeek prices are the peak rate. Off-peak is half, and the call row holds no hour rule, so a report shows the
// upper bound.
const deepseek = {
  label: "DeepSeek",
  tiers: { light: { model: "deepseek-flash" }, strong: { model: "deepseek-v4-pro" } },
  prices: {
    "deepseek-flash": [
      {
        inputPerM: 0.3,
        cachedInputPerM: 0.006,
        outputPerM: 1.2,
        source: DEEPSEEK_PRICING_URL,
        checked: "2026-11-19",
      },
    ],
    "deepseek-v4-pro": [
      {
        inputPerM: 1.32,
        cachedInputPerM: 0.044,
        outputPerM: 3.96,
        source: DEEPSEEK_PRICING_URL,
        checked: "2026-11-19",
      },
    ],
  },
  effort: "levels",
} satisfies LlmProviderCatalogRow;

export const llmProviderCatalog = { openai, gemini, deepseek } satisfies Record<string, LlmProviderCatalogRow>;

export type LlmProviderId = keyof typeof llmProviderCatalog;

export const llmProviderIds = Object.keys(llmProviderCatalog) as [LlmProviderId, ...LlmProviderId[]];

/** A provider id read from stored JSON. A row written before the provider was logged, or any other value, reads `null`. */
export function toProviderId(value: unknown): LlmProviderId | null {
  return typeof value === "string" && (llmProviderIds as readonly string[]).includes(value)
    ? (value as LlmProviderId)
    : null;
}

/**
 * The tier and the effort level of each role. The values equal the committed gate files and the old judge default, so
 * OpenAI keeps its production models. The drafter level `low` comes from its gate file.
 */
export const llmRoleModels: Record<LlmRole, { tier: LlmTier; effort: LlmEffortLevel }> = {
  classifier: { tier: "light", effort: "none" },
  drafter: { tier: "light", effort: "low" },
  extractor: { tier: "light", effort: "none" },
  judge: { tier: "strong", effort: "none" },
  stylist: { tier: "light", effort: "low" },
};

export function tierModel(provider: LlmProviderId, tier: LlmTier): string {
  return llmProviderCatalog[provider].tiers[tier].model;
}

/** The effort the provider gets for a role level, or null when the provider takes none. */
export function providerEffort(provider: LlmProviderId, level: LlmEffortLevel): string | null {
  return llmProviderCatalog[provider].effort === "none" ? null : level;
}

/** The price rows of every provider as one map by model id. A model id is in one row only. */
export function flatCatalogPrices(): Record<string, LlmPrice[]> {
  return Object.assign({}, ...Object.values(llmProviderCatalog).map((row) => row.prices));
}
