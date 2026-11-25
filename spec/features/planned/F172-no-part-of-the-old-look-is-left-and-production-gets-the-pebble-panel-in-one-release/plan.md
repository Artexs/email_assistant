# F172 plan — the last sweep of the old look and the one Pebble release

> **Status 2026-11-25 — planned.** Plan base: ee4b61369. Seven stages; nothing built. Stage 06 is the coordinator's release run, stage 07 the coordinator's local cleanup. Cold review 1 fixed: § Cold review.

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Defaults for the owner: [`questions.md`](questions.md).

## Input

Task (coordinator, 2026-11-25), word for word: "the release steps (tag, deploy, smoke check, rollback), and what the VPS stage needs." "24-hour standing rule: no owner go; the release goes after CI is green on the release commit."

Board (owner, 2026-11-24, `spec/build.md`): the standing rule is "valid for 24 hours only, until 2026-11-25 evening, then ask again"; "The Pebble release takes the contact-sheet "go" as given once CI is green." PB-12: the release waits for "go" and for the 20-draft check. Owner (2026-11-23): "my goal is to don't leave their leftovers."

### Product decisions

- **P1 Release gate** (default, owner to confirm). Stage 06 compares the time of its run with the expiry of the standing rule (2026-11-25 18:00 Europe/Warsaw, or a later expiry on the board). Before it: no owner "go"; the release goes when CI is green on the release commit. After it: the coordinator asks the owner for "go" on the full sheet, and stage 06 does not start without it. Reason: the rule's own expiry; a board line can outlive it. Rejected: release on the board line alone.
- **P2 The 20-draft check** (default). Before the expiry, the record of 2026-11-21 in `docs/owner-decisions.md` (the 20-draft check is "not done", the judge stays) counts as "recorded" for PB-12 (the standing rule bypasses blockers). After the expiry, the "go" question of P1 also asks whether that record counts. Rejected: wait for the 20 answers in any case.
- **P3 The "what is new" card** (default). The card (`WhatsNew.tsx`, `lib/whats-new.ts`) stays behind `docs_links` (default off); it links to the docs site, whose publication is the owner's gate. It shows the newest release once per member and browser (`localStorage`) where the flag is on. Stage 06 records the flag state per production organization. Rejected: turn the flag on (a link to an unpublished site).
- **P4 Version** (default). `v0.5.0`: the whole panel look changes. Rejected: `v0.4.6`.
- **P5 Telegram button texts** (default). The Settings help names the Telegram buttons in words, not as ✅ and ✏️ (DB-8). Rejected: an emoji exception in the guard.
- **P6 Public release text** (default). "For users" names only what a member with the default flags sees: the new look, and the rule sentence if its page has no default-off flag. Approvals and the delegation columns go into the operator group `Changed`. The author and the Opus review hold this rule; T10 catches only literal parts of 7 or more characters of the flagged keys, so it is a net, not the proof. Rejected: name every new flow.

### Design decisions

- **D1 Guards, not a one-time grep.** A leftover kind that a test finds reliably gets a unit test: emoji in panel texts, a file nothing imports, a token nothing reads, a stock or arbitrary shadow. Others (an unused variant, a small control, a bare `shadow` class) are a one-time sweep with a list.
- **D2 Allow lists match the ADR.** After stage 02, each guard allow list holds only files that ADR 0037 names by their path under `apps/web/src/`. Where the ADR lacks an entry, the ADR text changes, not the code.
- **D3 One `bun.lock` change, only with consent.** `next-themes` has no reader. DB-1 says a stage that breaks it stops and asks. Stage 02 removes it only when the coordinator's task says "remove next-themes: yes" (the owner accepted questions.md 4, or the standing rule is valid at spawn time); else it keeps it and reports a follow-up.
- **D4 Unused variants go.** After the pages land, a variant or size that no source file outside `dev/` uses is removed; ADR 0037 decision 8 changes.
- **D5 Review before removal.** Stages 03 and 04 read the mockup shots in `design/`; stage 05 deletes `design/`.
- **D6 Deviation rule.** A screen that differs from its mockup shot is `accepted` (a decision names it), `fix` (a token, pattern, class or spacing change of up to about 100 lines; stage 04), or `proposal` (a follow-up ticket; does not block the release).
- **D7 No migration in the release.** Stage 06 checks it again at the release commit. So `deploy/rollback.sh` alone returns to `v0.4.5`.
- **D8 Local leftovers are moved, not deleted** (stage 07).
- **D9 Pattern page imports count** (default). A file that only `dev/` imports is used (`components/ui/tabs.tsx`); stage 01 keeps it, stage 02 owns `components/ui/`.
- **D10 One owner per file; 02 follows 01** (default). Stages 01 and 02 both need ADR 0037, `global.css` and the stage-01 list result. So 02 runs after 01. `docs/capabilities/web-panel.md` § Look belongs to stage 05 alone.

## Facts checked (2026-11-25, at ee4b61369)

- No migration and no `bun.lock` change since `v0.4.5`; `package.json` changes are scripts only. Last tag `v0.4.5`; `[Unreleased]` is empty.
- `changelogPage` skips `Unreleased`, so T10 alone does not read stage 05's text.
- `--font-sans` (Nunito) has no reader in the source: Tailwind's base styles read it. `--text-xs--line-height` is a companion of `--text-xs`.
- `Placeholder.tsx` has no importer; `tabs.tsx` has only a `dev/` importer; 19 files import through `@/`.
- Arbitrary shadows: `button.tsx` (primary) and `StickyActions.tsx` (the phone bar). The bare word `shadow` is also a mode value and appears in comments.
- The sheet has no state for a user with no organization (`e2e/ui-sheet/routes.ts`).
- Emoji ✅ ✏️ only in `cat_help` (en, pl); the plural objects hold none.
- `design/`: 55 tracked files (48 shots, 12 screens), 7 `.gitignore` lines, one ESLint ignore.
- The docs deploy publishes nothing while `OWNER_REVIEW_PENDING` is set.
- The v0.4.5 release (`notes/2026-11-15-vps-deploy-queue.md`) gives the VPS route, the watch script and the lessons.

## Not verified

- Whether `docs_links` is on in production (stage 06 reads `org:flag`; v0.4.5 had no flag change).
- The run time of a full `ui:sheet` (stage 03 has a long timeout).

## Done when

Ticket acceptance (5 items), plus: `visual-review.md` lists all 48 shots with a final verdict, and `deploy/release.sh` printed `release ok v0.5.0 previous v0.4.5`.

## Rules for every stage

- DB-1 holds (no migration, no API, URL or schema change), except D3 with consent.
- A gap or a deviation is a question in the final message, not a choice.
- Format only the stage's files. Every text key in `en` and `pl`.

## Proof

Worker stages 01–05 name their Proof in the stage file. Each saves logs under `/tmp/f172-NN/` and ends with `echo PROOF_OK`.

## Owner checkpoints and steps

- P1: after the standing rule expires, the owner's "go" on the full sheet (and the P2 answer) gates stage 06. The sheet stays in its folder under `~/.local/share/email-assistant/ui-sheet/` until the release lands.
- Owner record after the release: the installed phone app shows the teal icon and the new look. Not a stop.

## Review

Opus before the land: 01, 05 (new Polish text). Sonnet: 02, 04. No review for 03 (no code), 06, 07 (coordinator runs).

## Stages

| # | Stage | Needs | May run next to |
| --- | --- | --- | --- |
| 01 | [Leftover guards](stages/stage-01-leftover-guards.md) | all page stages | — |
| 02 | [Stock classes, variants, dependency](stages/stage-02-stock-sweep.md) | 01; `bun.lock` lock | — |
| 03 | [Visual review, verdicts only](stages/stage-03-visual-review.md) | 02 | — |
| 04 | [Visual fixes](stages/stage-04-visual-fixes.md) | 03 | — |
| 05 | [Mockup out, changelog in](stages/stage-05-mockup-out.md) | 04 | — |
| 06 | [Release v0.5.0](stages/stage-06-release.md) — coordinator | 05; P1 gate | 07 |
| 07 | [Local leftovers](stages/stage-07-local-leftovers.md) — coordinator | 05 | 06 |

## How to run (coordinator)

Move the folder to `active/` first. One job per worker stage, board flags, `--prepare 'bash scripts/limen-prepare.sh'`:

```
limen spawn <flags> --label "<what the stage changes> · F172" 'Implement F172 stage NN. Read docs/product/pebble-ui/README.md and ticket.md, plan.md, stages/stage-NN-<slug>.md of spec/features/active/F172-<slug>/. Final proof: the Proof of the stage. List as proven only what a saved log shows.'
```

Stage 02's task adds "remove next-themes: yes" or "no" (D3). Stages 03 and 04 get `--timeout 150m`. Land with `--keep-open` but the last; drop the job DB. Run stage 07 step 1 in the turn that lands stage 05. Keep the ui-sheet folder of stage 03 at its land.

## Planning progress

Stages 01–07 [written]. Scouts: 0 (the task forbids `limen wait`; the planner read the code). Words (`wc -w`): plan 1498, stages 700, 698, 624, 528, 700, 698, 428.

## Cold review

Model: Opus (deploy, VPS, new Polish text). Job `2026-11-25-f172-plan-review-c90ba9ce` at `867ab63b1`: FAIL, [`plan-review-1.md`](plan-review-1.md). Each finding and its fix: [`review-fixes-1.md`](review-fixes-1.md). No second round (task).

## Log

- 2026-11-25: plan written at ee4b61369.
- 2026-11-25: review 1 fixed; stage 03 split into review and fixes; seven stages.
