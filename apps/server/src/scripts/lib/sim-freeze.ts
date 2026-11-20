import { join } from "node:path";

import {
  applyVerdict,
  freezeIssues,
  manifestBody,
  nextVersion,
  pickAuditCases,
  simParts,
  valueCategories,
  type CaseText,
  type Manifest,
  type Scenario,
  type SimBlindCase,
  type SimPart,
  type Slot,
  type ValueCategory,
} from "@ea/core";

import {
  auditPaths,
  corpusDir,
  readManifest,
  readPlanSpec,
  readScenario,
  readVerdicts,
  writeJson,
  writeManifest,
  writeSlots,
  writeText,
} from "../../platform/sim-files";
import type { IncomingSimCommand } from "../sim-args";

import {
  blindEntries,
  blindHash,
  fail,
  loadCorpus,
  ok,
  perPart,
  type Corpus,
  type PartData,
  type SimResult,
} from "./sim-corpus-load";
import { check } from "./sim-report";

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

export async function freeze(cmd: Extract<IncomingSimCommand, { kind: "freeze" }>): Promise<SimResult> {
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

export async function auditList(cmd: Extract<IncomingSimCommand, { kind: "audit-list" }>): Promise<SimResult> {
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

export async function auditApply(cmd: Extract<IncomingSimCommand, { kind: "audit-apply" }>): Promise<SimResult> {
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
