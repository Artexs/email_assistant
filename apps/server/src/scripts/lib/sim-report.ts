import {
  checkBatch,
  checkCase,
  checkSpread,
  hardCaseTagIds,
  planBank,
  planWeek,
  simParts,
  valueCategories,
  type ValueCategory,
} from "@ea/core";

import {
  batchName,
  corpusDir,
  hasFiles,
  listBatches,
  readBlindBatch,
  readLabelBatch,
  readManifest,
  readPlanSpec,
  readScenario,
  readSlotBatch,
  readTextBatch,
  removeSlots,
  writeJson,
  writeSlots,
} from "../../platform/sim-files";
import type { IncomingSimCommand } from "../sim-args";

import { blindEntries, blindHash, fail, inRange, loadPart, ok, partsOf, type SimResult } from "./sim-corpus-load";

export function plan(cmd: Extract<IncomingSimCommand, { kind: "plan" }>): SimResult {
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

export async function status(cmd: Extract<IncomingSimCommand, { kind: "status" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const manifest = readManifest(dir);
  const lines: string[] = [
    manifest === undefined
      ? "manifest: not frozen"
      : `manifest: v${manifest.version} audit ${manifest.audit.status} (${manifest.audit.wrong} wrong)`,
  ];
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

export function brief(cmd: Extract<IncomingSimCommand, { kind: "brief" }>): SimResult {
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

export async function check(cmd: Extract<IncomingSimCommand, { kind: "check" }>): Promise<SimResult> {
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
