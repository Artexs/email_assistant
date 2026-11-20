import { readFileSync } from "node:fs";

import {
  checkSentCase,
  nextSentVersion,
  planSentBank,
  sentBlindHash,
  sentBlindOf,
  sentExpectedOf,
  sentFreezeIssues,
  sentHardCaseTags,
  sentLabelDisagreements,
  sentLabelSchema,
  sentManifestBody,
  sentParts,
  type Scenario,
  type SentBlindCase,
  type SentLabel,
  type SentManifest,
  type SentPart,
  type SentSlot,
  type SentText,
} from "@ea/core";
import { z } from "zod";

import { batchName, batchNumber, corpusDir, listBatches, readScenario } from "../../platform/sim-files";
import type { BatchFolder } from "../../platform/sim-files";
import {
  readSentBlindBatch,
  readSentLabelBatch,
  readSentLabels,
  readSentManifest,
  readSentPlanSpec,
  readSentSlotBatch,
  readSentSlots,
  readSentTextBatch,
  readSentTexts,
  removeSentSlots,
  writeSentBatchFile,
  writeSentManifest,
  writeSentSlots,
} from "../../platform/sim-sent-files";
import type { SentSimCommand } from "../sim-args";

// The sent-bank variants of the sim commands. Lines hold counts, ids and codes, never mail text.
export interface SentSimResult {
  code: number;
  lines: string[];
}

const ok = (lines: string[]): SentSimResult => ({ code: 0, lines });
const fail = (...lines: string[]): SentSimResult => ({ code: 1, lines });

interface PartData {
  part: SentPart;
  slots: SentSlot[];
  texts: Map<string, SentText>;
  labels: Map<string, SentLabel>;
}

function loadPart(dir: string, part: SentPart): PartData {
  return { part, slots: readSentSlots(dir, part), texts: readSentTexts(dir, part), labels: readSentLabels(dir, part) };
}

const hasTexts = (dir: string, part: SentPart) => listBatches(dir, part, "texts").length > 0;

function blindEntries(scenario: Scenario, data: PartData): Map<string, SentBlindCase> {
  const entries = new Map<string, SentBlindCase>();
  for (const slot of data.slots) {
    const text = data.texts.get(slot.id);
    if (text !== undefined) entries.set(slot.id, sentBlindOf(slot, text, scenario));
  }
  return entries;
}

function inRange(batch: string, range: { from: number; to: number } | undefined): boolean {
  if (range === undefined) return true;
  const n = batchNumber(batch);
  return n >= range.from && n <= range.to;
}

const batchesOf = (dir: string, part: SentPart, folders: readonly BatchFolder[]) =>
  [...new Set(folders.flatMap((folder) => listBatches(dir, part, folder)))].sort();

// A label counts when it is of the current text.
function freshLabels(scenario: Scenario, data: PartData): Map<string, SentLabel> {
  const entries = blindEntries(scenario, data);
  const fresh = new Map<string, SentLabel>();
  for (const [id, label] of data.labels) {
    const entry = entries.get(id);
    if (entry !== undefined && label.blindHash === sentBlindHash(entry)) fresh.set(id, label);
  }
  return fresh;
}

type Cmd<K extends SentSimCommand["kind"]> = Extract<SentSimCommand, { kind: K }>;

function plan(cmd: Cmd<"plan">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const spec = readSentPlanSpec(dir);
  // The slot is the truth: a part with texts is not planned again without --force.
  if (!cmd.force && sentParts.some((part) => hasTexts(dir, part))) return fail("texts exist: use --force");
  const bank = planSentBank(scenario, spec);
  const lines: string[] = [];
  for (const part of sentParts) {
    removeSentSlots(dir, part);
    const paths = writeSentSlots(dir, part, bank[part]);
    lines.push(`part ${part} slots ${bank[part].length} batches ${paths.length}`);
  }
  return ok(lines);
}

function brief(cmd: Cmd<"brief">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const file = readSentSlotBatch(dir, cmd.part, batchName(cmd.batch));
  if (file === undefined) return fail(`${cmd.part}/slots/${batchName(cmd.batch)}.json: missing`);
  const used = new Set(file.slots.flatMap((slot) => [...slot.to, ...slot.cc, ...slot.thread.map((item) => item.from)]));
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
  const { key, displayName, address, lang, timeZone, voice, signature } = scenario.executive;
  const out = {
    scenario: { company: scenario.company, topics: scenario.topics },
    executive: { key, displayName, address, lang, timeZone, voice, signature },
    personas,
    slots: file.slots,
  };
  return ok([JSON.stringify(out, null, 2)]);
}

function check(cmd: Cmd<"check">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  return checkParts(dir, scenario, [cmd.part], cmd.range);
}

function checkParts(
  dir: string,
  scenario: Scenario,
  parts: readonly SentPart[],
  range: { from: number; to: number } | undefined
): SentSimResult {
  const lines: string[] = [];
  let issues = 0;
  let anyText = false;
  const report = (line: string) => {
    lines.push(line);
    issues += 1;
  };
  for (const part of parts) {
    const batches = batchesOf(dir, part, ["slots", "texts"]).filter((batch) => inRange(batch, range));
    if (batches.length === 0) continue;
    const data = loadPart(dir, part);
    const entries = blindEntries(scenario, data);
    const slotById = new Map(data.slots.map((slot) => [slot.id, slot]));
    for (const batch of batches) {
      readSentSlotBatch(dir, part, batch);
      const textFile = readSentTextBatch(dir, part, batch);
      if (textFile !== undefined) anyText = true;
      const texts = textFile?.cases ?? [];
      const textIds = new Set(texts.map((text) => text.id));
      for (const slot of data.slots.filter((s) => s.batch === batch)) {
        if (!textIds.has(slot.id)) report(`case ${slot.id} missing_text`);
      }
      for (const text of texts) {
        const slot = slotById.get(text.id);
        if (slot === undefined || slot.batch !== batch) report(`case ${text.id} slot_unknown`);
        else for (const issue of checkSentCase(slot, text, scenario)) report(`case ${issue.id} ${issue.code}`);
      }
      for (const label of readSentLabelBatch(dir, part, batch)?.labels ?? []) {
        const entry = entries.get(label.id);
        if (entry === undefined) report(`case ${label.id} label_unknown`);
        else if (label.blindHash !== sentBlindHash(entry)) report(`case ${label.id} label_stale`);
      }
      // The blind file must parse; blind-export refreshes one that differs from the texts.
      readSentBlindBatch(dir, part, batch);
    }
  }
  if (!anyText) return fail("nothing written in range");
  lines.push(issues === 0 ? "ok" : `issues ${issues}`);
  return { code: issues === 0 ? 0 : 1, lines };
}

function blindExport(cmd: Cmd<"blind-export">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const data = loadPart(dir, cmd.part);
  const batches = listBatches(dir, cmd.part, "texts").filter((batch) => inRange(batch, cmd.range));
  if (batches.length === 0) return fail("nothing written in range");
  const entries = blindEntries(scenario, data);
  const lines: string[] = [];
  for (const batch of batches) {
    const cases = data.slots
      .filter((slot) => slot.batch === batch && entries.has(slot.id))
      .map((slot) => entries.get(slot.id) as SentBlindCase);
    writeSentBatchFile(dir, cmd.part, "blind", batch, { scenario: cmd.scenario, part: cmd.part, batch, cases });
    lines.push(`blind ${batch} cases ${cases.length}`);
  }
  return ok(lines);
}

// The checker's label file: a list of labels without the blind hash (the import adds it).
const labelInputSchema = z.array(z.object({ id: z.string() }).loose());

function labelImport(cmd: Cmd<"label-import">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const batch = batchName(cmd.batch);
  let given: z.infer<typeof labelInputSchema>;
  try {
    given = labelInputSchema.parse(JSON.parse(readFileSync(cmd.file, "utf8")));
  } catch {
    return fail("label file: not a list of labels");
  }
  const data = loadPart(dir, cmd.part);
  const entries = blindEntries(scenario, data);
  const inBatch = new Set(data.slots.filter((slot) => slot.batch === batch).map((slot) => slot.id));
  const unknown = given.filter((label) => !inBatch.has(label.id) || !entries.has(label.id));
  if (unknown.length > 0) return fail(...unknown.map((label) => `label_unknown ${label.id}`));

  const merged = new Map((readSentLabelBatch(dir, cmd.part, batch)?.labels ?? []).map((l) => [l.id, l] as const));
  const invalid: string[] = [];
  for (const raw of given) {
    const label = sentLabelSchema.safeParse({ ...raw, blindHash: sentBlindHash(entries.get(raw.id) as SentBlindCase) });
    if (label.success) merged.set(raw.id, label.data);
    else invalid.push(`label_invalid ${raw.id}`);
  }
  if (invalid.length > 0) return fail(...invalid);
  const labels = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeSentBatchFile(dir, cmd.part, "labels", batch, {
    scenario: cmd.scenario,
    part: cmd.part,
    batch,
    checker: cmd.checker,
    labels,
  });
  return ok([`label ${batch} imported ${given.length} total ${labels.length}`]);
}

function stale(cmd: Cmd<"stale">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const data = loadPart(dir, cmd.part);
  const entries = blindEntries(scenario, data);
  const lines = data.slots
    .filter((slot) => inRange(slot.batch, cmd.range))
    .filter((slot) => {
      const entry = entries.get(slot.id);
      const label = data.labels.get(slot.id);
      return entry !== undefined && (label === undefined || label.blindHash !== sentBlindHash(entry));
    })
    .map((slot) => `stale ${slot.id}`);
  return ok(lines);
}

function reconcile(cmd: Cmd<"reconcile">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const data = loadPart(dir, cmd.part);
  const fresh = freshLabels(scenario, data);
  const lines: string[] = [];
  for (const slot of data.slots.filter((s) => inRange(s.batch, cmd.range))) {
    const label = fresh.get(slot.id);
    if (label === undefined) continue;
    const fields = sentLabelDisagreements(sentExpectedOf(slot, scenario.executive.timeZone), label);
    if (fields.length > 0) lines.push(`disagree ${slot.id} fields ${fields.join(",")}`);
  }
  return ok(lines);
}

function status(cmd: Cmd<"status">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const manifest = readSentManifest(dir);
  const lines = [manifest === undefined ? "not frozen" : `frozen ${manifest.version}`];
  const data = loadPart(dir, cmd.part);
  const fresh = freshLabels(scenario, data);
  let labelled = 0;
  let agree = 0;
  let disagree = 0;
  const byTag = new Map<string, { slots: number; written: number }>();
  for (const slot of data.slots) {
    const written = data.texts.has(slot.id);
    const label = fresh.get(slot.id);
    if (label !== undefined) {
      labelled += 1;
      if (sentLabelDisagreements(sentExpectedOf(slot, scenario.executive.timeZone), label).length > 0) disagree += 1;
      else agree += 1;
    }
    for (const tag of slot.hardCases) {
      const counts = byTag.get(tag) ?? { slots: 0, written: 0 };
      counts.slots += 1;
      if (written) counts.written += 1;
      byTag.set(tag, counts);
    }
  }
  const writtenCount = data.slots.filter((slot) => data.texts.has(slot.id)).length;
  lines.push(
    `part ${cmd.part} slots ${data.slots.length} written ${writtenCount} labelled ${labelled} agree ${agree} disagree ${disagree}`
  );
  for (const tag of sentHardCaseTags) {
    const counts = byTag.get(tag);
    if (counts !== undefined) lines.push(`part ${cmd.part} tag ${tag} slots ${counts.slots} written ${counts.written}`);
  }
  return ok(lines);
}

const MAX_ISSUE_LINES = 10;

function freeze(cmd: Cmd<"freeze">): SentSimResult {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const spec = readSentPlanSpec(dir);
  const checked = checkParts(dir, scenario, sentParts, undefined);
  if (checked.code !== 0) return checked;

  const corpus = { "sent-dev": loadPart(dir, "sent-dev"), "sent-holdout": loadPart(dir, "sent-holdout") };
  const planned = planSentBank(scenario, spec);
  const input = {
    slots: { "sent-dev": corpus["sent-dev"].slots, "sent-holdout": corpus["sent-holdout"].slots },
    texts: { "sent-dev": corpus["sent-dev"].texts, "sent-holdout": corpus["sent-holdout"].texts },
    labels: {
      "sent-dev": freshLabels(scenario, corpus["sent-dev"]),
      "sent-holdout": freshLabels(scenario, corpus["sent-holdout"]),
    },
    planned: {
      "sent-dev": planned["sent-dev"].map((slot) => slot.id),
      "sent-holdout": planned["sent-holdout"].map((slot) => slot.id),
    },
    timeZone: scenario.executive.timeZone,
  };
  const issues = sentFreezeIssues(input, { minDev: cmd.minDev, minHoldout: cmd.minHoldout });
  if (issues.length > 0) {
    const lines: string[] = [];
    for (const code of new Set(issues.map((issue) => issue.code))) {
      const own = issues.filter((issue) => issue.code === code);
      lines.push(`${code} ${own.length}`);
      for (const issue of own.slice(0, MAX_ISSUE_LINES)) lines.push(`  ${code} ${issue.detail}`);
    }
    return { code: 1, lines };
  }

  const body = sentManifestBody(input);
  const previous = readSentManifest(dir);
  // A part hash covers the slots and the texts, so a dropped case changes it too.
  const same =
    previous !== undefined && sentParts.every((part) => previous.parts[part]?.sha256 === body.parts[part].sha256);
  if (previous !== undefined && same) return ok([`unchanged ${previous.version}`]);

  const manifest: SentManifest = {
    scenario: scenario.id,
    version: previous === undefined ? "sent-v1" : nextSentVersion(previous.version),
    frozenAt: cmd.date ?? new Date().toISOString().slice(0, 10),
    ...body,
  };
  writeSentManifest(dir, manifest);
  return ok([
    `frozen ${manifest.version}`,
    ...sentParts.map(
      (part) => `part ${part} cases ${manifest.parts[part]?.cases} sha256 ${manifest.parts[part]?.sha256}`
    ),
    ...sentParts.flatMap((part) => (manifest.dropped[part] ?? []).map((id) => `dropped ${part} ${id}`)),
  ]);
}

export function runSentSim(cmd: SentSimCommand): SentSimResult {
  switch (cmd.kind) {
    case "plan":
      return plan(cmd);
    case "status":
      return status(cmd);
    case "brief":
      return brief(cmd);
    case "check":
      return check(cmd);
    case "blind-export":
      return blindExport(cmd);
    case "label-import":
      return labelImport(cmd);
    case "stale":
      return stale(cmd);
    case "reconcile":
      return reconcile(cmd);
    case "freeze":
      return freeze(cmd);
  }
}
