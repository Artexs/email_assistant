import { otherAddressOf, type CaseText, type Manifest, type Scenario, type Slot } from "@ea/core";

import { corpusDir, readManifest, readScenario, readSlots, readTexts } from "../../platform/sim-files";

export const LAB_MAILBOXES = {
  lab: "wiktor.szalewski@kordelan.test",
  demo: "wiktor.szalewski@demo.kordelan.test",
} as const;

export interface LabCorpus {
  scenario: Scenario;
  slots: Map<string, Slot>;
  texts: Map<string, CaseText>;
  manifest: Manifest;
  // The parent chain of a slot, root first; the slot itself is not in it.
  parentsOf(slotId: string): Slot[];
}

// Reads `scenario.json`, `manifest.json` and `week/` only. The lab never opens `holdout/` or `dev/`.
export async function loadLabCorpus(root: string, scenarioId: string): Promise<LabCorpus> {
  const dir = corpusDir(scenarioId, root);
  const scenario = readScenario(dir);
  const manifest = readManifest(dir);
  if (manifest === undefined) throw new Error(`corpus ${scenarioId}: manifest.json is missing`);
  const slots = new Map(readSlots(dir, "week").map((slot) => [slot.id, slot]));
  const texts = readTexts(dir, "week");

  function parentsOf(slotId: string): Slot[] {
    const chain: Slot[] = [];
    const seen = new Set<string>([slotId]);
    for (let parentId = slots.get(slotId)?.parentId; parentId !== undefined; ) {
      const parent = slots.get(parentId);
      if (parent === undefined) throw new Error(`corpus ${scenarioId}: parent of ${slotId} is missing`);
      if (seen.has(parent.id)) throw new Error(`corpus ${scenarioId}: parent chain of ${slotId} has a cycle`);
      seen.add(parent.id);
      chain.unshift(parent);
      parentId = parent.parentId;
    }
    return chain;
  }

  return { scenario, slots, texts, manifest, parentsOf };
}

// The `allowedAddresses` input of `checkSimEnv`: every scenario address, both executive mailboxes and the
// `other_address` alias of each delegate (`otherAddressOf`), the address a bot may answer from.
export function labAddresses(corpus: LabCorpus): string[] {
  const addresses = new Set<string>([corpus.scenario.executive.address, ...Object.values(LAB_MAILBOXES)]);
  for (const persona of corpus.scenario.personas) {
    addresses.add(persona.address);
    if (persona.group === "delegate") addresses.add(otherAddressOf(persona.address));
  }
  for (const slot of corpus.slots.values()) if (slot.fromOverride !== undefined) addresses.add(slot.fromOverride);
  return [...addresses].map((address) => address.toLowerCase()).sort();
}
