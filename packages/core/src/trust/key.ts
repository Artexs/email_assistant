import { z } from "zod";

// The identity of a model setup that gate evidence belongs to.
export const evidenceEndpoints = ["standard", "eu", "own"] as const;
export type EvidenceEndpoint = (typeof evidenceEndpoints)[number];

/** The key as stored in `category_policy[cat].grant.key` (strict: a key of another shape is a stored error, not a match). */
export const evidenceKeySchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().nullable(),
  promptVersion: z.string(),
  promptParts: z.array(z.string()).nullable(),
  endpoint: z.enum(evidenceEndpoints),
  host: z.string().nullable(),
});

export interface EvidenceKey {
  provider: string;
  model: string;
  reasoningEffort: string | null;
  promptVersion: string;
  promptParts: string[] | null;
  endpoint: EvidenceEndpoint;
  host: string | null;
}

/** The categories the history check and "recommended" cover. */
export const movingCategories = ["info", "notification", "spam"] as const;
export type MovingCategory = (typeof movingCategories)[number];

// `null` means no parts, so it equals `[]`.
const sortedParts = (parts: readonly string[] | null): string => JSON.stringify([...(parts ?? [])].sort());

/** Equal keys have equal evidence. `host` counts only for an own endpoint; part order does not count. */
export function sameKey(a: EvidenceKey, b: EvidenceKey): boolean {
  if (
    a.provider !== b.provider ||
    a.model !== b.model ||
    a.reasoningEffort !== b.reasoningEffort ||
    a.promptVersion !== b.promptVersion ||
    a.endpoint !== b.endpoint ||
    sortedParts(a.promptParts) !== sortedParts(b.promptParts)
  ) {
    return false;
  }
  return a.endpoint !== "own" || a.host === b.host;
}
