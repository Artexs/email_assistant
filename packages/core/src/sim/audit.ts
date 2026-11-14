import { z } from "zod";

import { createRng, deriveSeed } from "./random";
import { slotSchema, valueCategories, type Slot } from "./slot";

export const AUDIT_RANDOM = 30;
export const AUDIT_CONTESTED = 20;

// Random cases by seed, then the contested ones (D35).
export function pickAuditCases(input: {
  ids: readonly string[];
  contested: readonly string[];
  seed: number;
  version: string;
}): { random: string[]; contested: string[] } {
  const sorted = [...new Set(input.ids)].sort();
  const rng = createRng(deriveSeed(input.seed, `audit:${input.version}`));
  const random = rng.shuffle(sorted).slice(0, AUDIT_RANDOM).sort();
  const taken = new Set(random);
  const contested = [...new Set(input.contested)]
    .filter((id) => !taken.has(id))
    .sort()
    .slice(0, AUDIT_CONTESTED);
  return { random, contested };
}

export const verdictFileSchema = z
  .object({
    scenario: z.string(),
    version: z.string(),
    verdicts: z.array(
      z
        .object({
          id: z.string(),
          verdict: z.string().regex(new RegExp(`^(pending|ok|wrong: (${valueCategories.join("|")}))$`)),
        })
        .strict()
    ),
  })
  .strict();
export type VerdictFile = z.infer<typeof verdictFileSchema>;

// `wrong: <category>` makes the owner's category the truth; the fields that depend on the category follow it.
export function applyVerdict(slot: Slot, verdict: string): Slot {
  const match = /^wrong: (\w+)$/.exec(verdict);
  const category = valueCategories.find((c) => c === match?.[1]);
  if (category === undefined || category === slot.category) return slot;

  const next: Record<string, unknown> = { ...slot, category };
  next.urgencySource = category === "urgent" ? "text" : undefined;
  next.contextRef = undefined;
  next.expectedDelegate = undefined;
  next.expectedDraft = category === "delegation" ? "clarification" : undefined;
  return slotSchema.parse(next);
}
