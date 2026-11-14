import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  checkBatch,
  checkCase,
  checkSpread,
  hardCaseTagIds,
  planBank,
  planWeek,
  simParts,
  toEvalCase,
  valueCategories,
  type CaseText,
  type Scenario,
  type SimBlindCase,
  type SimPart,
  type Slot,
  type ValueCategory,
} from "@ea/core";
import { z } from "zod";

import { bodyTextFromSource, renderSeedMessage } from "../modules/mail";

import type { SimCommand } from "./sim-args";
import {
  batchName,
  batchNumber,
  corpusDir,
  hasFiles,
  listBatches,
  readBlindBatch,
  readLabelBatch,
  readLabelEntries,
  readPlanSpec,
  readScenario,
  readSlotBatch,
  readSlots,
  readTextBatch,
  readTexts,
  removeSlots,
  SimFileError,
  writeBatchFile,
  writeJson,
  writeSlots,
  type LabelEntry,
} from "./sim-files";

// A command returns its output lines and an exit code; the script prints them. Lines hold counts, ids and codes, never mail text.
export interface SimResult {
  code: number;
  lines: string[];
}

const ok = (lines: string[]): SimResult => ({ code: 0, lines });
const fail = (...lines: string[]): SimResult => ({ code: 1, lines });

// The corpus version of the joined case is not part of the blind view.
const BLIND_CORPUS_VERSION = "blind";
const MAX_PARENTS = 3;

interface PartData {
  part: SimPart;
  slots: Slot[];
  texts: Map<string, CaseText>;
  labels: Map<string, LabelEntry>;
}

function loadPart(dir: string, part: SimPart): PartData {
  return { part, slots: readSlots(dir, part), texts: readTexts(dir, part), labels: readLabelEntries(dir, part) };
}

// Mail that the checker labels: written, kept, and received (a mail the executive sent has no category to check).
function isLabelled(slot: Slot, text: CaseText | undefined): text is CaseText {
  return text !== undefined && text.dropped !== true && slot.direction !== "sent";
}

async function blindEntries(scenario: Scenario, data: PartData): Promise<Map<string, SimBlindCase>> {
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

function inRange(batch: string, range: { from: number; to: number } | undefined): boolean {
  if (range === undefined) return true;
  const n = batchNumber(batch);
  return n >= range.from && n <= range.to;
}

function rangeSlots(data: PartData, range: { from: number; to: number } | undefined): Slot[] {
  return data.slots.filter((slot) => inRange(slot.batch, range));
}

const partsOf = (part: SimPart | undefined): readonly SimPart[] => (part === undefined ? simParts : [part]);

function plan(cmd: Extract<SimCommand, { kind: "plan" }>): SimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const spec = readPlanSpec(dir);
  if (hasFiles(dir, "texts")) return fail("texts exist: re-plan not allowed");
  if (hasFiles(dir, "slots") && !cmd.force) return fail("slots exist: use --force");

  const bank = planBank(scenario, spec);
  const week = planWeek(scenario, spec);
  const lines: string[] = [];
  for (const [part, slots] of [
    ["dev", bank.dev],
    ["holdout", bank.holdout],
    ["week", week.slots],
  ] as const) {
    removeSlots(dir, part);
    const paths = writeSlots(dir, part, slots);
    lines.push(`part ${part} slots ${slots.length} batches ${paths.length}`);
  }
  writeJson(`${dir}/week/history.json`, week.history);
  return ok(lines);
}

const zero = () => ({ slots: 0, written: 0, dropped: 0, labelled: 0, agree: 0, disagree: 0, borderline: 0 });
type Counts = ReturnType<typeof zero>;
const countsLine = (c: Counts) =>
  `slots ${c.slots} written ${c.written} dropped ${c.dropped} labelled ${c.labelled} agree ${c.agree} disagree ${c.disagree} borderline ${c.borderline}`;

async function status(cmd: Extract<SimCommand, { kind: "status" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const lines: string[] = [];
  const total = zero();
  for (const part of simParts) {
    const data = loadPart(dir, part);
    if (data.slots.length === 0) continue;
    const entries = await blindEntries(scenario, data);
    const byCategory = new Map<ValueCategory, Counts>(valueCategories.map((c) => [c, zero()]));
    const byTag = new Map<string, { slots: number; written: number }>();
    for (const slot of data.slots) {
      const text = data.texts.get(slot.id);
      const counts = byCategory.get(slot.category) as Counts;
      counts.slots += 1;
      const written = text !== undefined && text.dropped !== true;
      if (written) counts.written += 1;
      if (text?.dropped === true) counts.dropped += 1;
      if (written && text.note?.startsWith("borderline:") === true) counts.borderline += 1;
      // Only a label of the current text counts.
      const label = data.labels.get(slot.id);
      const entry = entries.get(slot.id);
      if (label !== undefined && entry !== undefined && label.blindHash === blindHash(entry)) {
        counts.labelled += 1;
        counts[label.category === slot.category ? "agree" : "disagree"] += 1;
      }
      for (const tag of slot.hardCases) {
        const tagCounts = byTag.get(tag) ?? { slots: 0, written: 0 };
        tagCounts.slots += 1;
        if (written) tagCounts.written += 1;
        byTag.set(tag, tagCounts);
      }
    }
    for (const category of valueCategories) {
      const counts = byCategory.get(category) as Counts;
      lines.push(`part ${part} category ${category} ${countsLine(counts)}`);
      for (const key of Object.keys(total) as (keyof Counts)[]) total[key] += counts[key];
    }
    for (const tag of hardCaseTagIds) {
      const counts = byTag.get(tag);
      if (counts !== undefined) lines.push(`part ${part} tag ${tag} slots ${counts.slots} written ${counts.written}`);
    }
  }
  lines.push(`total ${countsLine(total)}`);
  return ok(lines);
}

function brief(cmd: Extract<SimCommand, { kind: "brief" }>): SimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const file = readSlotBatch(dir, cmd.part, batchName(cmd.batch));
  if (file === undefined) return fail(`${cmd.part}/slots/${batchName(cmd.batch)}.json: missing`);
  const used = new Set(file.slots.flatMap((slot) => [slot.persona, ...slot.thread.map((item) => item.persona)]));
  const personas = scenario.personas
    .filter((persona) => used.has(persona.key))
    .map(({ key, displayName, address, group, lang, voice, signature }) => ({
      key,
      displayName,
      address,
      group,
      lang,
      voice,
      signature,
    }));
  const delegates = scenario.delegates.map((delegate) => ({
    persona: delegate.persona,
    name: scenario.personas.find((persona) => persona.key === delegate.persona)?.displayName ?? delegate.persona,
    tags: delegate.tags,
  }));
  const out = {
    scenario: {
      company: scenario.company,
      executive: scenario.executive,
      topics: scenario.topics,
      urgency: scenario.urgency,
    },
    personas,
    delegates,
    // The sender history is a fact for the classifier, not for the writer.
    slots: file.slots.map(({ senderHistory: _history, ...slot }) => slot),
  };
  return ok([JSON.stringify(out, null, 2)]);
}

async function check(cmd: Extract<SimCommand, { kind: "check" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const spec = readPlanSpec(dir);
  const lines: string[] = [];
  let issues = 0;
  let anyText = false;
  const report = (line: string) => {
    lines.push(line);
    issues += 1;
  };

  for (const part of partsOf(cmd.part)) {
    const batches = [...new Set([...listBatches(dir, part, "slots"), ...listBatches(dir, part, "texts")])].filter(
      (batch) => inRange(batch, cmd.range)
    );
    if (batches.length === 0) continue;
    const data = loadPart(dir, part);
    const entries = await blindEntries(scenario, data);
    const slotById = new Map(data.slots.map((slot) => [slot.id, slot]));
    for (const batch of batches) {
      readSlotBatch(dir, part, batch);
      const textFile = readTextBatch(dir, part, batch);
      if (textFile !== undefined) anyText = true;
      const slots = data.slots.filter((slot) => slot.batch === batch);
      const texts = textFile?.cases ?? [];
      const textIds = new Set(texts.map((text) => text.id));
      for (const slot of slots) if (!textIds.has(slot.id)) report(`case ${slot.id} text_missing`);
      for (const text of texts) {
        const slot = slotById.get(text.id);
        if (slot === undefined || slot.batch !== batch) report(`case ${text.id} slot_unknown`);
        else if (text.dropped !== true) {
          for (const issue of checkCase(slot, text, scenario)) report(`case ${issue.id} ${issue.code}`);
        }
      }
      for (const issue of checkBatch(texts.filter((text) => text.dropped !== true))) {
        report(`case ${issue.id} ${issue.code}`);
      }
      // A label of a dropped text stays in the file and is ignored.
      for (const label of readLabelBatch(dir, part, batch)?.labels ?? []) {
        const text = data.texts.get(label.id);
        if (text === undefined) report(`case ${label.id} label_unknown`);
        else if (text.dropped === true) continue;
        else {
          const entry = entries.get(label.id);
          if (entry === undefined) report(`case ${label.id} label_unknown`);
          else if (label.blindHash !== blindHash(entry)) report(`case ${label.id} label_stale`);
        }
      }
      // The blind file must parse; blind-export refreshes one that differs from the texts.
      readBlindBatch(dir, part, batch);
    }
    if (data.slots.length > 0 && data.slots.every((slot) => data.texts.has(slot.id))) {
      for (const issue of checkSpread(data.slots, [...data.texts.values()], spec, scenario)) {
        report(`spread ${part} ${issue.code} ${issue.detail}`);
      }
    }
  }
  if (!anyText) return fail("nothing written in range");
  lines.push(issues === 0 ? "ok" : `issues ${issues}`);
  return { code: issues === 0 ? 0 : 1, lines };
}

async function blindExport(cmd: Extract<SimCommand, { kind: "blind-export" }>): Promise<SimResult> {
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

async function labelImport(cmd: Extract<SimCommand, { kind: "label-import" }>): Promise<SimResult> {
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

async function stale(cmd: Extract<SimCommand, { kind: "stale" }>): Promise<SimResult> {
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

async function reconcile(cmd: Extract<SimCommand, { kind: "reconcile" }>): Promise<SimResult> {
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

export async function runSim(cmd: SimCommand): Promise<SimResult> {
  try {
    switch (cmd.kind) {
      case "plan":
        return plan(cmd);
      case "status":
        return await status(cmd);
      case "brief":
        return brief(cmd);
      case "check":
        return await check(cmd);
      case "blind-export":
        return await blindExport(cmd);
      case "label-import":
        return await labelImport(cmd);
      case "stale":
        return await stale(cmd);
      case "reconcile":
        return await reconcile(cmd);
    }
  } catch (error) {
    if (error instanceof SimFileError) return fail(error.message);
    throw error;
  }
}
