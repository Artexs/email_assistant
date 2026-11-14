import { createHash } from "node:crypto";

import { z } from "zod";

import type { CaseText } from "./files";
import type { PlanSpec } from "./plan-spec";
import { simParts, valueCategories, type SimPart, type Slot, type ValueCategory } from "./slot";

// The freeze record of a corpus: version, per-part counts and hashes, and the state of the owner audit (D34, D36).
export const manifestSchema = z
  .object({
    scenario: z.string(),
    // "1", then "1.1" after an audit change.
    version: z.string().regex(/^\d+(\.\d+)?$/),
    frozenAt: z.iso.date(),
    parts: z.record(
      z.enum(simParts),
      z
        .object({
          cases: z.number().int(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict()
    ),
    // Non-dropped cases per part and value category.
    counts: z.record(z.enum(simParts), z.partialRecord(z.enum(valueCategories), z.number().int())),
    // Non-dropped cases per hard-case tag, over all parts.
    hardCases: z.record(z.string(), z.number().int()),
    audit: z
      .object({
        status: z.enum(["pending", "done"]),
        list: z.string(),
        verdicts: z.string(),
        wrong: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

export interface FreezeInput {
  slots: Record<SimPart, Slot[]>;
  texts: Record<SimPart, Map<string, CaseText>>;
  // Fresh labels only: the caller leaves out a label whose blindHash differs from the current blind entry.
  labels: Record<SimPart, Map<string, ValueCategory>>;
  spec: PlanSpec;
}

export type FreezeIssueCode =
  | "unwritten"
  | "unlabelled"
  | "open_disagreement"
  | "too_few"
  | "hard_too_few"
  | "week_dropped";

// An issue holds ids, categories and counts, never mail text.
export interface FreezeIssue {
  code: FreezeIssueCode;
  detail: string;
}

export interface FreezeFloors {
  minDev: number;
  minHoldout: number;
  hardShare: number;
}

// P3: the floors of the frozen bank.
export const defaultFreezeFloors: FreezeFloors = { minDev: 50, minHoldout: 200, hardShare: 0.8 };

// A mail the executive sent has no category to check (it has no label).
function needsLabel(slot: Slot): boolean {
  return slot.direction !== "sent";
}

function keptPairs(slots: readonly Slot[], texts: Map<string, CaseText>): { slot: Slot; text: CaseText }[] {
  const pairs: { slot: Slot; text: CaseText }[] = [];
  for (const slot of slots) {
    const text = texts.get(slot.id);
    if (text !== undefined && text.dropped !== true) pairs.push({ slot, text });
  }
  return pairs;
}

const byId = (a: { slot: Slot }, b: { slot: Slot }) => (a.slot.id < b.slot.id ? -1 : a.slot.id > b.slot.id ? 1 : 0);

// sha256 of the JSON of the [slot, text] pairs of the kept cases, sorted by id. A dropped text leaves the hash.
export function partHash(slots: readonly Slot[], texts: Map<string, CaseText>): string {
  const pairs = keptPairs(slots, texts)
    .sort(byId)
    .map(({ slot, text }) => [slot, text]);
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
}

export type ManifestBody = Pick<Manifest, "parts" | "counts" | "hardCases">;

// Hashes and counts of the kept cases of every part.
export function manifestBody(input: Pick<FreezeInput, "slots" | "texts">): ManifestBody {
  const hardCases: Record<string, number> = {};
  const counts = (part: SimPart) => {
    const perCategory: Partial<Record<ValueCategory, number>> = {};
    for (const { slot } of keptPairs(input.slots[part], input.texts[part])) {
      perCategory[slot.category] = (perCategory[slot.category] ?? 0) + 1;
      for (const tag of slot.hardCases) hardCases[tag] = (hardCases[tag] ?? 0) + 1;
    }
    return perCategory;
  };
  const hash = (part: SimPart) => ({
    cases: keptPairs(input.slots[part], input.texts[part]).length,
    sha256: partHash(input.slots[part], input.texts[part]),
  });
  const countsByPart = { dev: counts("dev"), holdout: counts("holdout"), week: counts("week") };
  return {
    parts: { dev: hash("dev"), holdout: hash("holdout"), week: hash("week") },
    counts: countsByPart,
    hardCases,
  };
}

// Why a corpus cannot freeze yet. An empty list means it can.
export function freezeIssues(input: FreezeInput, floors: FreezeFloors): FreezeIssue[] {
  const issues: FreezeIssue[] = [];
  const add = (code: FreezeIssueCode, detail: string) => issues.push({ code, detail });

  for (const part of simParts) {
    for (const slot of input.slots[part]) {
      const text = input.texts[part].get(slot.id);
      if (text === undefined) {
        add("unwritten", `${part} ${slot.id}`);
        continue;
      }
      if (text.dropped === true) {
        if (part === "week") add("week_dropped", slot.id);
        continue;
      }
      if (!needsLabel(slot)) continue;
      const label = input.labels[part].get(slot.id);
      if (label === undefined) add("unlabelled", `${part} ${slot.id}`);
      else if (label !== slot.category && text.note?.startsWith("borderline:") !== true) {
        add("open_disagreement", `${part} ${slot.id} slot ${slot.category} blind ${label}`);
      }
    }
  }

  const body = manifestBody(input);
  for (const [part, floor] of [
    ["dev", floors.minDev],
    ["holdout", floors.minHoldout],
  ] as const) {
    for (const category of valueCategories) {
      const count = body.counts[part][category] ?? 0;
      if (count < floor) add("too_few", `${part} ${category} ${count}|${floor}`);
    }
  }

  const planned: Record<string, number> = {};
  for (const part of simParts) {
    for (const slot of input.slots[part]) for (const tag of slot.hardCases) planned[tag] = (planned[tag] ?? 0) + 1;
  }
  for (const tag of Object.keys(planned).sort()) {
    const count = body.hardCases[tag] ?? 0;
    const plannedCount = planned[tag] as number;
    if (count < floors.hardShare * plannedCount) add("hard_too_few", `${tag} ${count}|${plannedCount}`);
  }
  return issues;
}

// The next version after an audit change: "1" → "1.1", "1.1" → "1.2".
export function nextVersion(version: string): string {
  const [major, minor] = version.split(".");
  return `${major}.${Number(minor ?? "0") + 1}`;
}
