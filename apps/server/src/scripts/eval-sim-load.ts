import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type CaseText, type EvalCase, type SimPart, type Slot, toEvalCase } from "@ea/core";
import { z } from "zod";

import { bodyTextFromSource, renderSeedMessage } from "../modules/mail";

import { corpusDir, readScenario, readSlots, readTexts } from "./sim-files";

export const HOLDOUT_NEEDS_FREEZE = "holdout needs a frozen corpus: run sim freeze";
const MAX_PARENTS = 3;

export type SimAudit = "pending" | "done" | "not frozen";

export interface SimCorpusLoad {
  cases: EvalCase[];
  version: string;
  // Hash of the manifest file text; null while the corpus is not frozen.
  manifestSha: string | null;
  audit: SimAudit;
  // Slots of the part that are not cases: counts only.
  skipped: { dropped: number; unwritten: number; sent: number };
}

// The loader reads only what the report header needs; the manifest owner (the freeze command) checks the rest.
const manifestHeadSchema = z.object({
  version: z.string().min(1),
  audit: z.object({ status: z.enum(["pending", "done"]) }),
});

function readManifestHead(dir: string): { version: string; sha: string; audit: "pending" | "done" } | null {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const parsed = manifestHeadSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("manifest.json is not valid: run sim freeze");
  return {
    version: parsed.data.version,
    sha: createHash("sha256").update(text).digest("hex"),
    audit: parsed.data.audit.status,
  };
}

// What the pipeline reads from an html-only mail: render it as a mail, read it back with the IMAP mapper.
async function htmlBodyText(input: {
  subject: string;
  html: string;
  from: string;
  to: string[];
  date: Date;
}): Promise<string | null> {
  return bodyTextFromSource(Buffer.from(renderSeedMessage(input)));
}

// Up to three earlier slots of the thread, oldest first.
function parentChain(slot: Slot, slots: ReadonlyMap<string, Slot>, texts: ReadonlyMap<string, CaseText>) {
  const chain: { slot: Slot; text: CaseText }[] = [];
  let parentId = slot.parentId;
  while (parentId !== undefined && chain.length < MAX_PARENTS) {
    const parent = slots.get(parentId);
    const text = texts.get(parentId);
    if (parent === undefined || text === undefined) throw new Error(`thread parent has no slot or text: ${parentId}`);
    chain.unshift({ slot: parent, text });
    parentId = parent.parentId;
  }
  return chain;
}

// One eval case per written, not dropped slot of the part, in sorted id order. A sent week slot is not a case.
export async function loadSimCases(input: {
  root: string;
  scenario: string;
  part: SimPart;
  requireManifest: boolean;
}): Promise<SimCorpusLoad> {
  const dir = corpusDir(input.scenario, input.root);
  const manifest = readManifestHead(dir);
  if (manifest === null && input.requireManifest) throw new Error(HOLDOUT_NEEDS_FREEZE);
  const version = manifest?.version ?? "draft";
  const scenario = readScenario(dir);
  const slots = readSlots(dir, input.part);
  const texts = readTexts(dir, input.part);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  const skipped = { dropped: 0, unwritten: 0, sent: 0 };
  const cases: EvalCase[] = [];
  for (const slot of [...slots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (slot.direction === "sent") {
      skipped.sent += 1;
      continue;
    }
    const text = texts.get(slot.id);
    if (text === undefined) {
      skipped.unwritten += 1;
      continue;
    }
    if (text.dropped === true) {
      skipped.dropped += 1;
      continue;
    }
    const parents = parentChain(slot, slotById, texts);
    cases.push(
      await toEvalCase(
        { slot, text, scenario, corpusVersion: version, ...(parents.length > 0 ? { parents } : {}) },
        { htmlBodyText }
      )
    );
  }
  return {
    cases,
    version,
    manifestSha: manifest?.sha ?? null,
    audit: manifest?.audit ?? "not frozen",
    skipped,
  };
}
