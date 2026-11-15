# F113 stage 11 — scorer: triage and M1

Part of [`../plan.md`](../plan.md). Decisions D14, P6.

## Goal

`bun run lab score --run <id>` joins each injected slot to its stored mail and triage result in the sim DB and writes the first half of the report: per-category results, M1, and what never arrived.

## Files

`apps/server/src/modules/lab/score/` (new folder: `join.ts`, `triage.ts`, `report.ts`), the `score` command.

## Interfaces

```ts
type ScoredMail = { slotId: string; emailId: string | null; predicted: Category | null; truth: Category; urgencySource?: UrgencySource; hardCases: string[]; lateBySec?: number; skipped?: string };
joinRun(db: Db, ctx: TenantContext, run: LabRun, events: LabEvent[], corpus: LabCorpus): Promise<ScoredMail[]>;
type LabScore = { header: ScoreHeader; triage: TriageScore; m1: MissedImportant; sections: Record<string, unknown> };
scoreTriage(rows: ScoredMail[]): TriageScore;
renderLabReport(score: LabScore): { markdown: string; json: string };
```

Stage 12 adds entries to `sections` and its own render parts; keep `renderLabReport` open for that (one renderer per section).

## Decisions

- **Join.** Injected slots = slots with `inject_done`. The mail = the `emails` row of the run mailbox whose Message-ID header equals the slot's lab Message-ID (normalized like the delegation finder does). The result = the latest `triage_results` row of that mail. Every query filters `org_id`.
- `sent` slots are not scored for triage (they are executive mail). They count in a "sent copies" line: appended n, seen by the server n (an `emails` row exists in the Sent folder or the Sent store, when that store exists at your commit).
- **Missing.** Injected but no mail → `not_synced`. Mail but no triage → `not_triaged`. Skipped slots → `skipped` with their code. These rows are left out of precision and recall and listed as counts.
- **Triage table.** Per category (the six value categories plus `unsure` as a predicted value): support, tp, fp, fn, precision, recall, with the Wilson 95 % interval (`wilsonInterval`, core). Use the existing core metric helpers (`computeMetrics` or the one `eval --sim` uses); no new formula.
- False-negative rate for `urgent` and `needs_reply`; urgent recall per `urgencySource` (`text`, `vip`, `context`); recall per hard-case tag (counts).
- **M1.** `missedImportant` (core `metrics/m1.ts`) with one `MailTruthRow` per scored mail: `truth` = slot category, `truthSource` null, `wrongOnly` false, `predicted` = the result. No change to the core type.
- **Header.** Run id, mode, start, `offsetDays`, corpus id, version and manifest hash, owner audit status, model ids seen in `llm.call` rows, cap and spend, stop reason, scored at.
- **Files.** `<out>/sim-<scored date>-lab-01-<mode>-<runId>.md` and `.json`; default `<out>` = `evals/results/` (the container writes to `LAB_STATE_DIR/results/`; the runbook copies it out). The JSON holds counts and slot ids, no text and no address (week ids are allowed, F097 D28).
- A run that is not stopped can be scored; the header says `partial`.

## Tests

Unit (`scoreTriage`, `renderLabReport`) with a fixture of 10 scored mails: urgent 3 (predicted urgent 2, info 1), needs_reply 2 (1 right, 1 notification), spam 3 right, notification 1 right, info 1 predicted urgent:
1. urgent: tp 2, fp 1, fn 1; precision 0.6667, recall 0.6667.
2. FN rate urgent 0.3333; needs_reply 0.5.
3. M1: important 5, misses 2.
4. Urgent recall by source with sources `text`, `vip`, `context` on the three urgent rows (only the `context` one missed) → 1, 1, 0.
5. The markdown holds no subject or body string of the fixture texts; the JSON parses.

Integration (job DB):
6. Seed an org with 3 mails whose Message-IDs are lab ids of run R and their triage rows; one lab id has no mail → `joinRun` gives 3 joined, 1 `not_synced`.
7. A mail of another org with the same Message-ID is not joined (tenant). Mutation: drop the `org_id` filter → test 7 fails. Restore.
8. Two triage rows for one mail → the latest is used.

## Done when

Tests pass; `live-lab.md` has the scorer rules and the report path; the Proof prints `PROOF_OK`.

## Out of scope

M2–M5, M7, behaviours, send limits (stage 12). A draft judge (questions.md Q8).
