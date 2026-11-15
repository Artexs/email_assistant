import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Db } from "../../../platform/db";
import type { LabCorpus } from "../corpus";
import { runModels, runSpend } from "../run-spend";
import type { LabEvent, LabRun, LabState } from "../state";

import { joinRun, joinSentCopies, type ScoredMail } from "./join";
import { renderLabReport, reportBaseName, type CoverageSection, type LabScore, type SentCopiesSection } from "./report";
import { scoreM1, scoreTriage } from "./triage";

export type ScoreErrorCode = "org_gone";

export class LabScoreError extends Error {
  constructor(readonly code: ScoreErrorCode) {
    super(code);
    this.name = "LabScoreError";
  }
}

export interface ScoreDeps {
  db: Db;
  state: LabState;
  corpus: LabCorpus;
  now(): Date;
}

/** What the plan and the events say about the run: planned, injected, skipped, not injected yet, late. */
export function coverageOf(run: LabRun, events: readonly LabEvent[]): CoverageSection {
  const planned = new Set(run.plan.items.map((item) => item.slotId));
  const injected = new Set<string>();
  const late = new Set<string>();
  const skipped = new Set<string>();
  for (const event of events) {
    if (event.t === "inject_done" && planned.has(event.slotId)) {
      injected.add(event.slotId);
      if ((event.lateBySec ?? 0) > 0) late.add(event.slotId);
    }
    if (event.t === "skip" && planned.has(event.ref)) skipped.add(event.ref);
  }
  const skippedOnly = [...skipped].filter((id) => !injected.has(id)).length;
  return {
    planned: planned.size,
    injected: injected.size,
    skipped: skippedOnly,
    pending: planned.size - injected.size - skippedOnly,
    late: late.size,
  };
}

// The slot rows of the JSON: slot ids, categories and codes; no mail id of the DB, no text.
const mailsOf = (rows: readonly ScoredMail[]) =>
  rows.map((row) => {
    const { emailId, ...rest } = row;
    return { ...rest, joined: emailId !== null };
  });

/** Scores the first half of the report (triage, M1, coverage, sent copies) for one run. A run that is not stopped is scored as `partial`. */
export async function scoreLabRun(deps: ScoreDeps, runId: string): Promise<LabScore> {
  const { db, state, corpus } = deps;
  const run = state.readRun(runId);
  const org = state.readOrgs()[run.org];
  if (org === undefined) throw new LabScoreError("org_gone");
  const ctx = { orgId: org.orgId };
  const events = state.events(runId);

  const rows = await joinRun(db, ctx, run, events, corpus, org.mailboxId);
  const sent = await joinSentCopies(db, ctx, run, events, corpus, org.mailboxId);
  const spend = await runSpend(db, org.orgId, run);
  const stopped = events.find((event) => event.t === "stopped");

  const sentCopies: SentCopiesSection = sent;
  return {
    header: {
      runId,
      mode: run.plan.mode,
      partial: stopped === undefined,
      startDate: run.plan.startDate,
      offsetDays: run.plan.offsetDays,
      corpusId: corpus.scenario.id,
      corpusVersion: corpus.manifest.version,
      manifestHash: createHash("sha256").update(JSON.stringify(corpus.manifest)).digest("hex"),
      auditStatus: corpus.manifest.audit.status,
      models: await runModels(db, org.orgId, run),
      capUsd: run.capUsd,
      spendUsd: spend.usd,
      spendUnpriced: spend.kind === "unpriced",
      stopReason: stopped?.t === "stopped" ? stopped.reason : "running",
      scoredAt: deps.now().toISOString(),
    },
    triage: scoreTriage(rows),
    m1: scoreM1(rows),
    sections: { coverage: coverageOf(run, events), sentCopies, mails: mailsOf(rows) },
  };
}

/** Writes `<out>/sim-<date>-lab-01-<runId>.md` and `.json`; returns the two paths. */
export function writeLabReport(score: LabScore, outDir: string): { markdown: string; json: string } {
  const { markdown, json } = renderLabReport(score);
  const base = join(outDir, reportBaseName(score.header));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.json`, json);
  return { markdown: `${base}.md`, json: `${base}.json` };
}
