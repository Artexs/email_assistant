import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyVerdict,
  checkBatch,
  checkCase,
  checkSpread,
  freezeIssues,
  hardCaseTagIds,
  manifestBody,
  nextVersion,
  pickAuditCases,
  planBank,
  planWeek,
  simParts,
  toEvalCase,
  valueCategories,
  type CaseText,
  type Manifest,
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
  auditPaths,
  batchName,
  batchNumber,
  corpusDir,
  hasFiles,
  listBatches,
  readBlindBatch,
  readLabelBatch,
  readLabelEntries,
  readManifest,
  readPlanSpec,
  readScenario,
  readSlotBatch,
  readSlots,
  readTextBatch,
  readTexts,
  readVerdicts,
  removeSlots,
  SimFileError,
  writeBatchFile,
  writeJson,
  writeManifest,
  writeSlots,
  writeText,
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

type Corpus = Record<SimPart, PartData>;

function loadCorpus(dir: string): Corpus {
  return { dev: loadPart(dir, "dev"), holdout: loadPart(dir, "holdout"), week: loadPart(dir, "week") };
}

const perPart = <T>(pick: (data: PartData) => T, corpus: Corpus): Record<SimPart, T> => ({
  dev: pick(corpus.dev),
  holdout: pick(corpus.holdout),
  week: pick(corpus.week),
});

// A label counts when it is of the current text.
async function freshLabels(scenario: Scenario, data: PartData): Promise<Map<string, ValueCategory>> {
  const entries = await blindEntries(scenario, data);
  const fresh = new Map<string, ValueCategory>();
  for (const [id, label] of data.labels) {
    const entry = entries.get(id);
    if (entry !== undefined && label.blindHash === blindHash(entry)) fresh.set(id, label.category);
  }
  return fresh;
}

const MAX_ISSUE_LINES = 10;

async function freeze(cmd: Extract<SimCommand, { kind: "freeze" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const spec = readPlanSpec(dir);
  if (readManifest(dir) !== undefined) return fail("manifest.json exists: delete it to freeze again");
  const checked = await check({
    kind: "check",
    scenario: cmd.scenario,
    ...(cmd.root === undefined ? {} : { root: cmd.root }),
  });
  if (checked.code !== 0) return checked;

  const corpus = loadCorpus(dir);
  const input = {
    slots: perPart((data) => data.slots, corpus),
    texts: perPart((data) => data.texts, corpus),
    labels: {
      dev: await freshLabels(scenario, corpus.dev),
      holdout: await freshLabels(scenario, corpus.holdout),
      week: await freshLabels(scenario, corpus.week),
    },
    spec,
  };
  const issues = freezeIssues(input, { minDev: cmd.minDev, minHoldout: cmd.minHoldout, hardShare: 0.8 });
  if (issues.length > 0) {
    const lines: string[] = [];
    for (const code of new Set(issues.map((issue) => issue.code))) {
      const own = issues.filter((issue) => issue.code === code);
      lines.push(`${code} ${own.length}`);
      for (const issue of own.slice(0, MAX_ISSUE_LINES)) lines.push(`  ${code} ${issue.detail}`);
    }
    return { code: 1, lines };
  }
  const paths = auditPaths(cmd.version);
  const manifest: Manifest = {
    scenario: scenario.id,
    version: cmd.version,
    frozenAt: cmd.date,
    ...manifestBody(input),
    audit: { status: "pending", list: paths.list, verdicts: paths.verdicts, wrong: 0 },
  };
  writeManifest(dir, manifest);
  return ok([
    `frozen v${cmd.version}`,
    ...Object.entries(manifest.parts).map(
      ([part, value]) => `part ${part} cases ${value.cases} sha256 ${value.sha256}`
    ),
  ]);
}

// Mail the owner can judge: kept and received (the same set the checker labels).
async function auditPool(scenario: Scenario, corpus: Corpus) {
  const pool: { part: SimPart; slot: Slot; text: CaseText; mail: SimBlindCase }[] = [];
  for (const part of simParts) {
    const data = corpus[part];
    const entries = await blindEntries(scenario, data);
    for (const slot of data.slots) {
      const text = data.texts.get(slot.id);
      const mail = entries.get(slot.id);
      if (text !== undefined && mail !== undefined) pool.push({ part, slot, text, mail });
    }
  }
  return pool;
}

const fence = (text: string) => ["~~~~", text, "~~~~"].join("\n");

function auditSection(item: Awaited<ReturnType<typeof auditPool>>[number], group: "random" | "contested"): string {
  const { part, slot, text, mail } = item;
  const lines = [
    `## ${slot.id}`,
    "",
    `- part: ${part} (${group})`,
    `- slot category: ${slot.category}`,
    `- urgency source: ${slot.urgencySource ?? "none"}`,
    `- hard cases: ${slot.hardCases.length === 0 ? "none" : slot.hardCases.join(", ")}`,
    `- brief: ${slot.brief}`,
    `- expected delegate: ${slot.expectedDelegate ?? "none"}`,
    `- expected points: ${(text.expectedPoints ?? []).length === 0 ? "none" : ""}`,
    ...(text.expectedPoints ?? []).map((point) => `  - ${point}`),
    ...(text.note === undefined ? [] : [`- writer note: ${text.note}`]),
    "",
    "Mail as the checker sees it:",
    "",
    `- from: ${mail.from}`,
    `- to: ${mail.to.join(", ")}`,
    `- cc: ${mail.cc.length === 0 ? "none" : mail.cc.join(", ")}`,
    `- subject: ${mail.subject}`,
    `- attachments: ${mail.attachments.length === 0 ? "none" : mail.attachments.join(", ")}`,
    "",
    fence(mail.body),
  ];
  mail.thread.forEach((entry, i) => {
    lines.push(
      "",
      `Thread ${i + 1} (oldest first): from ${entry.from}, subject ${entry.subject}`,
      "",
      fence(entry.body)
    );
  });
  return lines.join("\n");
}

async function auditList(cmd: Extract<SimCommand, { kind: "audit-list" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const spec = readPlanSpec(dir);
  const manifest = readManifest(dir);
  if (manifest === undefined) return fail("manifest.json: missing, freeze first");
  const paths = auditPaths(cmd.version);
  if (
    manifest.audit.status === "done" &&
    (manifest.version === cmd.version || manifest.audit.verdicts === paths.verdicts)
  ) {
    return fail(`audit of v${cmd.version} is done`);
  }
  if (manifest.version !== cmd.version) return fail(`version differs from the manifest (v${manifest.version})`);
  const existing = readVerdicts(dir, cmd.version);
  if (existing?.verdicts.some((entry) => entry.verdict !== "pending") === true) {
    return fail(`${paths.verdicts}: holds verdicts, not overwritten`);
  }

  const pool = await auditPool(scenario, loadCorpus(dir));
  const byId = new Map(pool.map((item) => [item.slot.id, item]));
  const picked = pickAuditCases({
    ids: pool.map((item) => item.slot.id),
    contested: pool.filter((item) => item.text.note?.startsWith("borderline:") === true).map((item) => item.slot.id),
    seed: spec.seed,
    version: cmd.version,
  });
  const sections = [
    ...picked.random.map((id) => auditSection(byId.get(id) as (typeof pool)[number], "random")),
    ...picked.contested.map((id) => auditSection(byId.get(id) as (typeof pool)[number], "contested")),
  ];
  const ids = [...picked.random, ...picked.contested];
  writeText(
    join(dir, paths.list),
    [
      `# Owner audit of ${scenario.id} v${cmd.version}`,
      "",
      `${ids.length} cases: ${picked.random.length} random, ${picked.contested.length} contested.`,
      `Judge each mail as a mail. Then set its line in ${paths.verdicts} to "ok" or "wrong: <category>".`,
      `Categories: ${valueCategories.join(", ")}.`,
      "",
      sections.join("\n\n"),
      "",
    ].join("\n")
  );
  writeJson(join(dir, paths.verdicts), {
    scenario: scenario.id,
    version: cmd.version,
    verdicts: ids.map((id) => ({ id, verdict: "pending" })),
  });
  return ok([
    join(dir, paths.list),
    join(dir, paths.verdicts),
    `random ${picked.random.length} contested ${picked.contested.length}`,
  ]);
}

async function auditApply(cmd: Extract<SimCommand, { kind: "audit-apply" }>): Promise<SimResult> {
  const dir = corpusDir(cmd.scenario, cmd.root);
  const scenario = readScenario(dir);
  const manifest = readManifest(dir);
  if (manifest === undefined) return fail("manifest.json: missing, freeze first");
  const file = readVerdicts(dir, cmd.version);
  if (file === undefined) return fail(`${auditPaths(cmd.version).verdicts}: missing`);
  if (file.scenario !== scenario.id || file.version !== cmd.version)
    return fail("verdict file: scenario or version differs");

  const corpus = loadCorpus(dir);
  const slotsById = new Map(
    simParts.flatMap((part) => corpus[part].slots.map((slot) => [slot.id, { part, slot }] as const))
  );
  const unknown = file.verdicts.filter((entry) => !slotsById.has(entry.id));
  if (unknown.length > 0) return fail(...unknown.map((entry) => `verdict_unknown ${entry.id}`));

  const changed = new Set<SimPart>();
  let changes = 0;
  const replaced = new Map<string, Slot>();
  for (const entry of file.verdicts) {
    const found = slotsById.get(entry.id) as { part: SimPart; slot: Slot };
    const next = applyVerdict(found.slot, entry.verdict);
    if (next !== found.slot) {
      replaced.set(entry.id, next);
      changed.add(found.part);
      changes += 1;
    }
  }
  const slots = perPart((data) => data.slots.map((slot) => replaced.get(slot.id) ?? slot), corpus);
  for (const part of changed) writeSlots(dir, part, slots[part]);

  const wrong = file.verdicts.filter((entry) => entry.verdict.startsWith("wrong:")).length;
  const pending = file.verdicts.filter((entry) => entry.verdict === "pending").length;
  const next: Manifest = {
    ...manifest,
    ...(changes > 0 ? { version: nextVersion(manifest.version), frozenAt: cmd.date } : {}),
    ...manifestBody({ slots, texts: perPart((data) => data.texts, corpus) }),
    audit: { ...manifest.audit, status: pending === 0 ? "done" : "pending", wrong },
  };
  writeManifest(dir, next);
  return ok([
    `verdicts ${file.verdicts.length} ok ${file.verdicts.length - wrong - pending} wrong ${wrong} pending ${pending}`,
    `changed ${changes}`,
    `version v${next.version} audit ${next.audit.status}`,
  ]);
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
      case "freeze":
        return await freeze(cmd);
      case "audit-list":
        return await auditList(cmd);
      case "audit-apply":
        return await auditApply(cmd);
    }
  } catch (error) {
    if (error instanceof SimFileError) return fail(error.message);
    throw error;
  }
}
