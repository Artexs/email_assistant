import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  blindBatchFileSchema,
  labelBatchFileSchema,
  manifestSchema,
  planSpecSchema,
  scenarioSchema,
  slotBatchFileSchema,
  textBatchFileSchema,
  validateScenario,
  verdictFileSchema,
  type CaseText,
  type Manifest,
  type PlanSpec,
  type Scenario,
  type SimBlindBatchFile,
  type SimLabelBatchFile,
  type SimPart,
  type SimTextBatchFile,
  type VerdictFile,
  type Slot,
  type SlotBatchFile,
  type ValueCategory,
  simParts,
} from "@ea/core";
import type { ZodType } from "zod";

// The only fs code of `bun run sim`. Corpus layout: evals/sim/<scenario>/<part>/{slots,texts,blind,labels}/batch-NNN.json.

const DEFAULT_ROOT = resolve(import.meta.dir, "../../../../evals/sim");

export type BatchFolder = "slots" | "texts" | "blind" | "labels";

// A file problem. The message holds file paths and issue codes, never mail text.
export class SimFileError extends Error {}

export function corpusDir(scenarioId: string, root: string = DEFAULT_ROOT): string {
  return resolve(root, scenarioId);
}

export function batchName(n: number): string {
  return `batch-${String(n).padStart(3, "0")}`;
}

export function batchNumber(name: string): number {
  return Number(name.slice("batch-".length));
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function batchPath(dir: string, part: SimPart, folder: BatchFolder, batch: string): string {
  return join(dir, part, folder, `${batch}.json`);
}

// Reads one JSON file through its schema; undefined when the file does not exist.
function readParsed<T>(dir: string, path: string, schema: ZodType<T>): T | undefined {
  if (!existsSync(path)) return undefined;
  const shown = relative(dir, path);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SimFileError(`${shown}: not valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const codes = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}:${issue.code}`);
    throw new SimFileError(`${shown}: schema issues ${codes.slice(0, 5).join(" ")}`);
  }
  return parsed.data;
}

export function readScenario(dir: string): Scenario {
  const scenario = readParsed(dir, join(dir, "scenario.json"), scenarioSchema);
  if (scenario === undefined) throw new SimFileError("scenario.json: missing");
  const issues = validateScenario(scenario);
  if (issues.length > 0) {
    throw new SimFileError(`scenario.json: ${issues.map((issue) => `${issue.code}(${issue.detail})`).join(" ")}`);
  }
  if (scenario.id !== basename(dir)) throw new SimFileError("scenario.json: id differs from the folder name");
  return scenario;
}

export function readPlanSpec(dir: string): PlanSpec {
  const spec = readParsed(dir, join(dir, "plan-spec.json"), planSpecSchema);
  if (spec === undefined) throw new SimFileError("plan-spec.json: missing");
  return spec;
}

// Batch names (`batch-NNN`) that have a file in the folder, in order.
export function listBatches(dir: string, part: SimPart, folder: BatchFolder): string[] {
  const path = join(dir, part, folder);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .map((file) => /^(batch-\d{3})\.json$/.exec(file)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

// Writes `slots/batch-NNN.json` for each batch of the slots; returns the paths.
export function writeSlots(dir: string, part: SimPart, slots: readonly Slot[]): string[] {
  const byBatch = new Map<string, Slot[]>();
  for (const slot of slots) byBatch.set(slot.batch, [...(byBatch.get(slot.batch) ?? []), slot]);
  const paths: string[] = [];
  for (const batch of [...byBatch.keys()].sort()) {
    const file: SlotBatchFile = {
      scenario: basename(dir),
      part,
      batch,
      slots: slotBatchFileSchema.shape.slots.parse(byBatch.get(batch)),
    };
    const path = batchPath(dir, part, "slots", batch);
    writeJson(path, file);
    paths.push(path);
  }
  return paths;
}

// Removes the slot files of a part (a forced re-plan).
export function removeSlots(dir: string, part: SimPart): void {
  rmSync(join(dir, part, "slots"), { recursive: true, force: true });
}

export function hasFiles(dir: string, folder: BatchFolder): boolean {
  return simParts.some((part) => listBatches(dir, part, folder).length > 0);
}

export function readSlotBatch(dir: string, part: SimPart, batch: string): SlotBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "slots", batch), slotBatchFileSchema);
}

export function readTextBatch(dir: string, part: SimPart, batch: string): SimTextBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "texts", batch), textBatchFileSchema);
}

export function readBlindBatch(dir: string, part: SimPart, batch: string): SimBlindBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "blind", batch), blindBatchFileSchema);
}

export function readLabelBatch(dir: string, part: SimPart, batch: string): SimLabelBatchFile | undefined {
  return readParsed(dir, batchPath(dir, part, "labels", batch), labelBatchFileSchema);
}

export function writeBatchFile(
  dir: string,
  part: SimPart,
  folder: Exclude<BatchFolder, "slots" | "texts">,
  batch: string,
  value: SimBlindBatchFile | SimLabelBatchFile
): string {
  const path = batchPath(dir, part, folder, batch);
  writeJson(path, value);
  return path;
}

export function readSlots(dir: string, part: SimPart): Slot[] {
  return listBatches(dir, part, "slots").flatMap((batch) => readSlotBatch(dir, part, batch)?.slots ?? []);
}

// Texts by slot id, from every `texts/` file of the part.
export function readTexts(dir: string, part: SimPart): Map<string, CaseText> {
  const texts = new Map<string, CaseText>();
  for (const batch of listBatches(dir, part, "texts")) {
    for (const text of readTextBatch(dir, part, batch)?.cases ?? []) texts.set(text.id, text);
  }
  return texts;
}

export interface LabelEntry {
  category: ValueCategory;
  blindHash: string;
}

export function readLabelEntries(dir: string, part: SimPart): Map<string, LabelEntry> {
  const labels = new Map<string, LabelEntry>();
  for (const batch of listBatches(dir, part, "labels")) {
    for (const label of readLabelBatch(dir, part, batch)?.labels ?? []) {
      labels.set(label.id, { category: label.category, blindHash: label.blindHash });
    }
  }
  return labels;
}

export function readLabels(dir: string, part: SimPart): Map<string, ValueCategory> {
  return new Map([...readLabelEntries(dir, part)].map(([id, entry]) => [id, entry.category]));
}

// Freeze and audit files: `manifest.json` and `audit/v<version>-{list.md,verdicts.json}`.
export function readManifest(dir: string): Manifest | undefined {
  return readParsed(dir, join(dir, "manifest.json"), manifestSchema);
}

export function writeManifest(dir: string, manifest: Manifest): void {
  writeJson(join(dir, "manifest.json"), manifest);
}

// Paths relative to the corpus folder, as the manifest holds them.
export function auditPaths(version: string): { list: string; verdicts: string } {
  return { list: `audit/v${version}-list.md`, verdicts: `audit/v${version}-verdicts.json` };
}

export function readVerdicts(dir: string, version: string): VerdictFile | undefined {
  return readParsed(dir, join(dir, auditPaths(version).verdicts), verdictFileSchema);
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
