import { createHash } from "node:crypto";

import { z } from "zod";

import { sentExpectedOf, sentLabelDisagreements } from "./sent-blind";
import { sentParts, type SentLabel, type SentPart, type SentSlot, type SentText } from "./sent-slot";

// The freeze record of the sent bank. It has its own file, `sent-manifest.json`; the manifest of
// the incoming corpus does not change.
export const sentManifestSchema = z
  .object({
    scenario: z.string(),
    // "sent-v1", then "sent-v2" when a part hash changes.
    version: z.string().regex(/^sent-v\d+$/),
    frozenAt: z.iso.date(),
    parts: z.record(
      z.enum(sentParts),
      z.object({ cases: z.number().int(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
    ),
    // Slot ids of the plan that a recorded slot removal dropped from the bank, per part.
    dropped: z.record(z.enum(sentParts), z.array(z.string())),
    // Cases per hard-case tag, over both parts.
    hardCases: z.record(z.string(), z.number().int()),
  })
  .strict();
export type SentManifest = z.infer<typeof sentManifestSchema>;

export interface SentFreezeInput {
  slots: Record<SentPart, SentSlot[]>;
  texts: Record<SentPart, Map<string, SentText>>;
  // Fresh labels only: the caller leaves out a label whose blindHash differs from the current blind entry.
  labels: Record<SentPart, Map<string, SentLabel>>;
  // Slot ids of the plan (the same seed gives the same ids); a planned id with no slot is a dropped case.
  planned: Record<SentPart, string[]>;
  timeZone: string;
}

export type SentFreezeIssueCode = "unwritten" | "unlabelled" | "label_disagrees" | "too_few";

// An issue holds part names, ids, field names and counts, never mail text.
export interface SentFreezeIssue {
  code: SentFreezeIssueCode;
  detail: string;
}

export interface SentFreezeFloors {
  minDev: number;
  minHoldout: number;
}

// At most 5 of 250 holdout cases and 1 of 50 dev cases may drop out of the bank.
export const sentFreezeFloors: SentFreezeFloors = { minDev: 49, minHoldout: 245 };

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// sha256 of the JSON of the [slot, text] pairs of the written cases, sorted by id.
export function sentPartHash(slots: readonly SentSlot[], texts: Map<string, SentText>): string {
  const pairs = slots
    .filter((slot) => texts.has(slot.id))
    .sort(byId)
    .map((slot) => [slot, texts.get(slot.id)]);
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
}

// Hashes, counts and dropped ids of the written cases of both parts.
export function sentManifestBody(input: Pick<SentFreezeInput, "slots" | "texts" | "planned">) {
  const hardCases: Record<string, number> = {};
  const parts = {} as SentManifest["parts"];
  const dropped = {} as SentManifest["dropped"];
  for (const part of sentParts) {
    const written = input.slots[part].filter((slot) => input.texts[part].has(slot.id));
    for (const slot of written) for (const tag of slot.hardCases) hardCases[tag] = (hardCases[tag] ?? 0) + 1;
    parts[part] = { cases: written.length, sha256: sentPartHash(input.slots[part], input.texts[part]) };
    const present = new Set(input.slots[part].map((slot) => slot.id));
    dropped[part] = input.planned[part].filter((id) => !present.has(id)).sort();
  }
  return { parts, dropped, hardCases };
}

// Why the sent bank cannot freeze yet. An empty list means it can.
export function sentFreezeIssues(input: SentFreezeInput, floors: SentFreezeFloors): SentFreezeIssue[] {
  const issues: SentFreezeIssue[] = [];
  const add = (code: SentFreezeIssueCode, detail: string) => issues.push({ code, detail });
  for (const [part, floor] of [
    ["sent-dev", floors.minDev],
    ["sent-holdout", floors.minHoldout],
  ] as const) {
    let agreeing = 0;
    for (const slot of input.slots[part]) {
      if (!input.texts[part].has(slot.id)) {
        add("unwritten", `${part} ${slot.id}`);
        continue;
      }
      const label = input.labels[part].get(slot.id);
      if (label === undefined) {
        add("unlabelled", `${part} ${slot.id}`);
        continue;
      }
      const fields = sentLabelDisagreements(sentExpectedOf(slot, input.timeZone), label);
      if (fields.length > 0) add("label_disagrees", `${part} ${slot.id} ${fields.join(",")}`);
      else agreeing += 1;
    }
    if (agreeing < floor) add("too_few", `${part} ${agreeing}|${floor}`);
  }
  return issues;
}

// The next version after a change: "sent-v1" → "sent-v2".
export function nextSentVersion(version: string): string {
  return `sent-v${Number(version.slice("sent-v".length)) + 1}`;
}
