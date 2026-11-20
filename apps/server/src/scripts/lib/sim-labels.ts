import { readFileSync } from "node:fs";

import { valueCategories, type SimBlindCase } from "@ea/core";
import { z } from "zod";

import {
  batchName,
  corpusDir,
  listBatches,
  readLabelBatch,
  readScenario,
  writeBatchFile,
} from "../../platform/sim-files";
import type { IncomingSimCommand } from "../sim-args";

import { blindEntries, blindHash, fail, inRange, loadPart, ok, rangeSlots, type SimResult } from "./sim-corpus-load";

export async function blindExport(cmd: Extract<IncomingSimCommand, { kind: "blind-export" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const data = loadPart(dir, cmd.part);
  const batches = listBatches(dir, cmd.part, "texts").filter((batch) => inRange(batch, cmd.range));
  if (batches.length === 0) return fail("nothing written in range");
  const entries = await blindEntries(scenario, data);
  const lines: string[] = [];
  for (const batch of batches) {
    const cases = data.slots
      .filter((slot) => slot.batch === batch && entries.has(slot.id))
      .map((slot) => entries.get(slot.id) as SimBlindCase);
    writeBatchFile(dir, cmd.part, "blind", batch, { scenario: cmd.scenario, part: cmd.part, batch, cases });
    lines.push(`blind ${batch} cases ${cases.length}`);
  }
  return ok(lines);
}

const labelInputSchema = z.array(z.object({ id: z.string(), category: z.enum(valueCategories) }).strict());

export async function labelImport(cmd: Extract<IncomingSimCommand, { kind: "label-import" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const batch = batchName(cmd.batch);
  let given: z.infer<typeof labelInputSchema>;
  try {
    given = labelInputSchema.parse(JSON.parse(readFileSync(cmd.file, "utf8")));
  } catch {
    return fail("label file: not a list of { id, category }");
  }
  const data = loadPart(dir, cmd.part);
  const entries = await blindEntries(scenario, data);
  const inBatch = new Set(data.slots.filter((slot) => slot.batch === batch).map((slot) => slot.id));
  const unknown = given.filter((label) => !inBatch.has(label.id) || !entries.has(label.id));
  if (unknown.length > 0) return fail(...unknown.map((label) => `label_unknown ${label.id}`));

  const merged = new Map(
    (readLabelBatch(dir, cmd.part, batch)?.labels ?? []).map((label) => [label.id, label] as const)
  );
  for (const label of given) {
    merged.set(label.id, {
      id: label.id,
      category: label.category,
      blindHash: blindHash(entries.get(label.id) as SimBlindCase),
    });
  }
  const labels = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeBatchFile(dir, cmd.part, "labels", batch, {
    scenario: cmd.scenario,
    part: cmd.part,
    batch,
    checker: cmd.checker,
    labels,
  });
  return ok([`label ${batch} imported ${given.length} total ${labels.length}`]);
}

export async function stale(cmd: Extract<IncomingSimCommand, { kind: "stale" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const data = loadPart(dir, cmd.part);
  const entries = await blindEntries(scenario, data);
  const lines = rangeSlots(data, cmd.range)
    .filter((slot) => {
      const entry = entries.get(slot.id);
      const label = data.labels.get(slot.id);
      return entry !== undefined && (label === undefined || label.blindHash !== blindHash(entry));
    })
    .map((slot) => `stale ${slot.id}`);
  return ok(lines);
}

export async function reconcile(cmd: Extract<IncomingSimCommand, { kind: "reconcile" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const data = loadPart(dir, cmd.part);
  const entries = await blindEntries(scenario, data);
  const lines: string[] = [];
  for (const slot of rangeSlots(data, cmd.range)) {
    const entry = entries.get(slot.id);
    const label = data.labels.get(slot.id);
    const text = data.texts.get(slot.id);
    if (entry === undefined || label === undefined || text === undefined) continue;
    if (label.blindHash !== blindHash(entry) || label.category === slot.category) continue;
    if (text.note?.startsWith("borderline:") === true) continue;
    const round = text.note?.startsWith("rewritten:") === true ? 2 : 1;
    lines.push(`disagree ${slot.id} slot ${slot.category} blind ${label.category} round ${round}`);
  }
  return ok(lines);
}
