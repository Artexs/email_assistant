import { rmSync } from "node:fs";
import { basename, join } from "node:path";

import {
  sentBlindBatchFileSchema,
  sentEvalCase,
  sentLabelBatchFileSchema,
  sentManifestSchema,
  sentPlanSpecSchema,
  sentSlotBatchFileSchema,
  sentTextBatchFileSchema,
  type SentBlindBatchFile,
  type SentEvalCase,
  type SentLabel,
  type SentLabelBatchFile,
  type SentManifest,
  type SentPart,
  type SentPlanSpec,
  type SentSlot,
  type SentSlotBatchFile,
  type SentText,
  type SentTextBatchFile,
} from "@ea/core";

import {
  batchPath,
  corpusDir,
  listBatches,
  readParsed,
  readScenario,
  SimFileError,
  writeJson,
  type BatchFolder,
} from "./sim-files";

// The fs code of the sent bank (F116 stage 02). Layout: <corpus>/<sent part>/{slots,texts,blind,labels}/batch-NNN.json.

export function readSentPlanSpec(dir: string): SentPlanSpec {
  const spec = readParsed(dir, join(dir, "sent-plan-spec.json"), sentPlanSpecSchema);
  if (spec === undefined) throw new SimFileError("sent-plan-spec.json: missing");
  return spec;
}

// Writes `slots/batch-NNN.json` for each batch of the slots; returns the paths.
export function writeSentSlots(dir: string, part: SentPart, slots: readonly SentSlot[]): string[] {
  const byBatch = new Map<string, SentSlot[]>();
  for (const slot of slots) byBatch.set(slot.batch, [...(byBatch.get(slot.batch) ?? []), slot]);
  const paths: string[] = [];
  for (const batch of [...byBatch.keys()].sort()) {
    const file: SentSlotBatchFile = {
      scenario: basename(dir),
      part,
      batch,
      slots: sentSlotBatchFileSchema.shape.slots.parse(byBatch.get(batch)),
    };
    const path = batchPath(dir, part, "slots", batch);
    writeJson(path, file);
    paths.push(path);
  }
  return paths;
}

export function removeSentSlots(dir: string, part: SentPart): void {
  rmSync(join(dir, part, "slots"), { recursive: true, force: true });
}

export function readSentSlotBatch(dir: string, part: SentPart, batch: string): SentSlotBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "slots", batch), sentSlotBatchFileSchema);
}

export function readSentTextBatch(dir: string, part: SentPart, batch: string): SentTextBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "texts", batch), sentTextBatchFileSchema);
}

export function readSentBlindBatch(dir: string, part: SentPart, batch: string): SentBlindBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "blind", batch), sentBlindBatchFileSchema);
}

export function readSentLabelBatch(dir: string, part: SentPart, batch: string): SentLabelBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "labels", batch), sentLabelBatchFileSchema);
}

export function writeSentBatchFile(
  dir: string,
  part: SentPart,
  folder: Extract<BatchFolder, "blind" | "labels">,
  batch: string,
  value: SentBlindBatchFile | SentLabelBatchFile
): string {
  const path = batchPath(dir, part, folder, batch);
  writeJson(path, value);
  return path;
}

export function readSentSlots(dir: string, part: SentPart): SentSlot[] {
  return listBatches(dir, part, "slots").flatMap((batch) => readSentSlotBatch(dir, part, batch)?.slots ?? []);
}

// Texts by slot id, from every `texts/` file of the part.
export function readSentTexts(dir: string, part: SentPart): Map<string, SentText> {
  const texts = new Map<string, SentText>();
  for (const batch of listBatches(dir, part, "texts")) {
    for (const text of readSentTextBatch(dir, part, batch)?.cases ?? []) texts.set(text.id, text);
  }
  return texts;
}

export function readSentLabels(dir: string, part: SentPart): Map<string, SentLabel> {
  const labels = new Map<string, SentLabel>();
  for (const batch of listBatches(dir, part, "labels")) {
    for (const label of readSentLabelBatch(dir, part, batch)?.labels ?? []) labels.set(label.id, label);
  }
  return labels;
}

export function readSentManifest(dir: string): SentManifest | undefined {
  return readParsed(dir, join(dir, "sent-manifest.json"), sentManifestSchema);
}

export function writeSentManifest(dir: string, manifest: SentManifest): void {
  writeJson(join(dir, "sent-manifest.json"), manifest);
}

// The eval cases of a sent part for the extractor gate: the blind view plus the slot labels, in slot order.
// The holdout loads only when the caller asks for it (`holdout: true`); prompt work reads `sent-dev` only.
export function sentEvalCasesOf(
  root: string | undefined,
  scenarioId: string,
  part: SentPart,
  options: { holdout?: boolean } = {}
): SentEvalCase[] {
  if (part === "sent-holdout" && options.holdout !== true) {
    throw new SimFileError("sent-holdout: pass { holdout: true } to load it");
  }
  const dir = corpusDir(scenarioId, root);
  const scenario = readScenario(dir);
  const texts = readSentTexts(dir, part);
  return readSentSlots(dir, part).flatMap((slot) => {
    const text = texts.get(slot.id);
    return text === undefined ? [] : [sentEvalCase(slot, text, scenario)];
  });
}
