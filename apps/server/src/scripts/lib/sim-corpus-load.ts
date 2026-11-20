import { createHash } from "node:crypto";

import {
  simParts,
  toEvalCase,
  type CaseText,
  type Scenario,
  type SimBlindCase,
  type SimPart,
  type Slot,
} from "@ea/core";

import { bodyTextFromSource, renderSeedMessage } from "../../modules/mail";
import { batchNumber, readLabelEntries, readSlots, readTexts, type LabelEntry } from "../../platform/sim-files";

// A command returns its output lines and an exit code; the script prints them. Lines hold counts, ids and codes, never mail text.
export interface SimResult {
  code: number;
  lines: string[];
}

export const ok = (lines: string[]): SimResult => ({ code: 0, lines });

export const fail = (...lines: string[]): SimResult => ({ code: 1, lines });

// The corpus version of the joined case is not part of the blind view.
const BLIND_CORPUS_VERSION = "blind";

const MAX_PARENTS = 3;

export interface PartData {
  part: SimPart;
  slots: Slot[];
  texts: Map<string, CaseText>;
  labels: Map<string, LabelEntry>;
}

export function loadPart(dir: string, part: SimPart): PartData {
  return { part, slots: readSlots(dir, part), texts: readTexts(dir, part), labels: readLabelEntries(dir, part) };
}

// Mail that the checker labels: written, kept, and received (a mail the executive sent has no category to check).
function isLabelled(slot: Slot, text: CaseText | undefined): text is CaseText {
  return text !== undefined && text.dropped !== true && slot.direction !== "sent";
}

export async function blindEntries(scenario: Scenario, data: PartData): Promise<Map<string, SimBlindCase>> {
  const slotById = new Map(data.slots.map((slot) => [slot.id, slot]));
  const entries = new Map<string, SimBlindCase>();
  for (const slot of data.slots) {
    const text = data.texts.get(slot.id);
    if (!isLabelled(slot, text)) continue;
    // A week reply carries its parent chain, oldest first, as the eval case does.
    const parents: { slot: Slot; text: CaseText }[] = [];
    for (let parent = slot.parentId; parent !== undefined && parents.length < MAX_PARENTS; ) {
      const parentSlot = slotById.get(parent);
      const parentText = parentSlot === undefined ? undefined : data.texts.get(parent);
      if (parentSlot === undefined || parentText === undefined) break;
      parents.unshift({ slot: parentSlot, text: parentText });
      parent = parentSlot.parentId;
    }
    const evalCase = await toEvalCase(
      {
        slot,
        text,
        scenario,
        corpusVersion: BLIND_CORPUS_VERSION,
        ...(parents.length > 0 ? { parents } : {}),
      },
      {
        htmlBodyText: (input) =>
          bodyTextFromSource(
            Buffer.from(
              renderSeedMessage({
                from: input.from,
                to: input.to,
                subject: input.subject,
                date: input.date,
                html: input.html,
              })
            )
          ),
      }
    );
    entries.set(slot.id, {
      id: slot.id,
      from: evalCase.from,
      to: evalCase.to,
      cc: evalCase.cc,
      subject: evalCase.subject,
      body: evalCase.body,
      thread: evalCase.thread.map((item) => ({ from: item.from, subject: item.subject, body: item.body })),
      attachments: slot.attachments.map((attachment) => attachment.name),
    });
  }
  return entries;
}

export function blindHash(entry: SimBlindCase): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

export function inRange(batch: string, range: { from: number; to: number } | undefined): boolean {
  if (range === undefined) return true;
  const n = batchNumber(batch);
  return n >= range.from && n <= range.to;
}

export function rangeSlots(data: PartData, range: { from: number; to: number } | undefined): Slot[] {
  return data.slots.filter((slot) => inRange(slot.batch, range));
}

export const partsOf = (part: SimPart | undefined): readonly SimPart[] => (part === undefined ? simParts : [part]);

export type Corpus = Record<SimPart, PartData>;

export function loadCorpus(dir: string): Corpus {
  return { dev: loadPart(dir, "dev"), holdout: loadPart(dir, "holdout"), week: loadPart(dir, "week") };
}

export const perPart = <T>(pick: (data: PartData) => T, corpus: Corpus): Record<SimPart, T> => ({
  dev: pick(corpus.dev),
  holdout: pick(corpus.holdout),
  week: pick(corpus.week),
});
