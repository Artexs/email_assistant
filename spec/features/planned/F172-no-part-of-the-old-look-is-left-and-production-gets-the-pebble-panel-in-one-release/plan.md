# F172 plan — the last sweep of the old look and the one Pebble release

> **Status 2026-11-25 — planned.** Plan base: ee4b61369. Six stages; nothing built. Stage 05 is the coordinator's release run, stage 06 the coordinator's local cleanup. Cold review: § Cold review.

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Defaults for the owner: [`questions.md`](questions.md).

## Input

Task (coordinator, 2026-11-25), word for word: "the release steps (tag, deploy, smoke check, rollback), and what the VPS stage needs." "24-hour standing rule: no owner go; the release goes after CI is green on the release commit."

Board (owner, 2026-11-24): "The Pebble release takes the contact-sheet "go" as given once CI is green." Owner (2026-11-23): "my goal is to don't leave their leftovers."

### Product decisions

- **P1 Release gate** (default, owner to confirm). The release needs no owner "go"; it goes when CI is green on the release commit. Reason: the task and the standing rule. If `spec/build.md` no longer holds that rule when stage 05 starts, the coordinator asks the owner for "go" first. Rejected: a hard stop for "go" (the task forbids it).
- **P2 The 20-draft check** (default). The record of 2026-11-21 in `docs/owner-decisions.md` (the owner check of 20 drafts is "not done", the judge stays) counts as "recorded" for PB-12. Rejected: wait for the 20 answers.
- **P3 The "what is new" card** (default). The card exists (`WhatsNew.tsx`, `lib/whats-new.ts`) behind the flag `docs_links`, and it links to the docs site changelog. This ticket does not turn `docs_links` on: the docs site publication is the owner's gate. The card shows the new release once per member wherever the flag is on. Stage 05 records the flag state per production organization. Rejected: turn the flag on (it publishes a link to an unpublished site).
- **P4 Version** (default). `v0.5.0`: the whole panel look changes. Rejected: `v0.4.6`.
- **P6 Public release text** (default). The "For users" group (the card and the public docs changelog) names only what a member with the default flags sees: the new look, and the rule sentence if its page has no default-off flag. The approvals queue and the delegation columns sit behind default-off flags; they go into the operator group `Changed`. Reason: the docs test T10 fails on flagged text (it made the first v0.4.5 release commit red). Rejected: name every new flow.
- **P5 Telegram button texts** (default). The Settings help text names the Telegram buttons in words, not as ✅ and ✏️ (DB-8). Rejected: an emoji exception in the guard.

### Design decisions

- **D1 Guards, not a one-time grep.** A leftover kind that a test can find gets a failing unit test: emoji in panel texts (left to this ticket by F166 stage 07), a file nothing imports, a token nothing reads, a stock shadow. A kind no test finds reliably (an unused variant, a small control height) is a one-time sweep with a written list.
- **D2 Allow lists match the ADR.** After stage 02, each guard allow list (`ALLOWED`, `ACCENT_FILES`, `H1_ALLOWED`, any list of stage 01) holds only files that ADR 0037 names. Where the ADR lacks an entry today (accent files, h1 owners), the ADR text changes, not the code.
- **D3 One `bun.lock` change.** `next-themes` has no reader (plan base). Stage 02 removes it: the programme's only `bun.lock` change, under the board lock; an exception to DB-1 and ADR 0037 decision 15 (questions.md 4).
- **D4 Unused variants go.** ADR 0037 decision 8 kept every variant and size name valid while the pages moved. After the pages land, a variant or size that no source file uses is removed, and stage 02 changes decision 8 to say so.
- **D5 Review before removal.** The one visual review (stage 03) reads the mockup shots in `design/`; stage 04 deletes `design/`. So 04 needs 03.
- **D6 Deviation rule of the visual review.** A screen that differs from its mockup shot is one of: an accepted deviation (PB-4, PB-7, PB-8, DB-1 name it), a fix in stage 03 (a token, pattern or class change), or a follow-up ticket proposal in `visual-review.md` (a change of layout or flow larger than about 100 lines). A proposal does not block the release: it is not the old look.
- **D7 No migration in the release.** `db/migrations/` did not change since `v0.4.5` (checked at the plan base). Stage 05 checks it again at the release commit. So `deploy/rollback.sh` alone returns to `v0.4.5`.
- **D8 Local leftovers are moved, not deleted.** The ignored design study files move out of the main checkout (stage 06). The scratch worktree `/tmp/ea-ui-shots` and its two seed DBs are removed (no owner data).

## Facts checked (2026-11-25, at ee4b61369)

- No migration and no `bun.lock` change since `v0.4.5`; `package.json` changes are scripts only. Last tag `v0.4.5`; `CHANGELOG.md` `[Unreleased]` is empty.
- Since `v0.4.5`: no server runtime change but e2e seed scripts, one new export in `packages/core/src/web`, no prompt change.
- The card reads `docs_links` (default off), stores the seen version per member, ignores `Unreleased`.
- `components/shell/Placeholder.tsx` has no importer. `next-themes` has no reader. `components/ui/select.tsx` uses `shadow-md`.
- The emoji ✅ ✏️ appear in `cat_help` (en, pl). Telegram buttons use them (`packages/core/src/digest/`).
- `design/`: 55 tracked files (48 mockup shots, 12 screens), 7 `.gitignore` lines, one ESLint ignore.
- No deferred list exists (no `notes/2026-11-25-pebble-visual-review.md`, none on the programme page); F166–F170 checked pictures only in part.
- The docs deploy on a tag publishes nothing while `OWNER_REVIEW_PENDING` is not empty (`docs-deploy.yml`).
- `approvals_page`, `delegation_pages`, `panel_review`, `stats_page` and `docs_links` are default-off flags with panel keys in `apps/docs/src/flagged-text.ts`; T10 checks the published changelog against them.
- The v0.4.5 release (`notes/2026-11-15-vps-deploy-queue.md`) gives the VPS route and lessons: `ssh home_vm`, `~/email_assistant`, a clean tree at the old tag, logs under `~/ea-logs/<tag>/`, far from the 03:30 backup cron, `release.sh` refuses a tag whose `package.json` version differs.

## Not verified

- Whether `docs_links` is on for any production organization: stage 05 reads `org:flag`.
- How the installed phone app picks up the new icon: Chrome refreshes an installed app's icon on its own schedule. Stage 05 records it; it is not a stop.
- The run time of a full `ui:sheet`: stage 03 has a long timeout.

## Done when

Ticket acceptance (5 items), plus: `visual-review.md` lists all 48 mockup shots with a verdict, and `deploy/release.sh` printed `release ok v0.5.0 previous v0.4.5`.

## Rules for every stage

- DB-1 holds (no migration, no API, URL or schema change), except D3.
- A gap or a deviation is a question in the final message, not a choice.
- Format only the stage's files. Every text key in `en` and `pl`. Update `docs/capabilities/web-panel.md` where a rule changes.

## Proof

Worker stages 01–04 name their Proof in the stage file. Each saves logs under `/tmp/f172-NN/` and ends with `echo PROOF_OK`.

## Owner checkpoints and steps

- No stop (P1). The full contact sheet of stage 03 stays in its folder under `~/.local/share/email-assistant/ui-sheet/` until the release lands; `visual-review.md` names the path. The owner may look at any time.
- Owner record after the release: the installed app on the owner's phone shows the teal icon and the new look. Not a stop.

## Review

Opus before the land: 01 (new Polish text), 04 (new Polish text in the changelog). Sonnet: 02, 03. No review for 05, 06 (coordinator runs).

## Stages

| # | Stage | Needs | May run next to |
| --- | --- | --- | --- |
| 01 | [Leftover guards](stages/stage-01-leftover-guards.md) | all page stages | 02 |
| 02 | [Stock classes, variants, dependency](stages/stage-02-stock-sweep.md) | all page stages; `bun.lock` lock | 01 |
| 03 | [The one visual review](stages/stage-03-visual-review.md) | 01, 02 | — |
| 04 | [Mockup out, changelog in](stages/stage-04-mockup-out.md) | 03 | — |
| 05 | [Release v0.5.0](stages/stage-05-release.md) — coordinator | 04 | 06 |
| 06 | [Local leftovers](stages/stage-06-local-leftovers.md) — coordinator | 04 | 05 |

## How to run (coordinator)

Move the folder to `active/` first. One job per worker stage, board flags, `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F172" 'Implement F172 stage NN. Read docs/product/pebble-ui/README.md and ticket.md, plan.md, stages/stage-NN-<slug>.md of spec/features/active/F172-<slug>/. Final proof: the Proof of the stage. List as proven only what a saved log shows.'
```

Stage 03 gets `--timeout 150m`. Land with `--keep-open` but the last; drop the job DB. Stages 05 and 06 are the coordinator's own runs: no spawn. Do not delete the ui-sheet folder of stage 03 at its land (P1).

## Planning progress

Stages 01–06 [written]. Scouts: 0 (the task forbids `limen wait` and polling; the planner read the code). Words (`wc -w`): plan 1476, stages 699, 697, 664, 678, 699, 413.

## Cold review

Model: Opus (deploy, VPS, new Polish text). Job: § Log.

## Log

- 2026-11-25: plan written at ee4b61369.
