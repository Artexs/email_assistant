# F169 plan — delegation columns, and the Pebble look for Open loops, Delegates and Rules

> **Status 2026-11-24 — planned.** Plan base: 8c9acfc1e. Ten stages; nothing built. No owner step is open.

Shared decisions, § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Names and values of the design system: `spec/features/active/F166-*/interfaces.md`. Drawing: `design/ui-proposals/proposals/03-pebble/`. Code facts: [`scouts.md`](scouts.md).

## Input

Owner's words: the programme page. This job's task (2026-11-23): "Its stages need F166 stages 03, 06, 09 and 10 only, so the four Pebble tickets build next to each other." Stages 02 and 06 also need F166 08 (Proof B tools); the rest get it through F166 06 or 10.

### Decisions

- **D1 Columns from today's filters.** Overdue = `filter=overdue`; Waiting for approval (`drafted`) and Sent = `filter=open`, split by status on the client; Answered = `filter=answered`; the closed list = `filter=closed`. Rejected: a new API filter per status (DB-1; ticket out of scope).
- **D2 One record per status** (`lib/delegation-columns.ts`, DB-8), tested against the core enum. Stage 01.
- **D3 A row shows once,** in the group of its status; an id in two feeds goes to the first group in page order.
- **D4 Paging.** Overdue, Answered and closed page on their own cursor. Drafted and Sent share the open cursor: "Show more" in either loads open pages until the clicked column gains a row or the cursor ends, at most 4 pages a click; the focus goes to its first new row, else to the status line (`dgn_col_no_more`). The 30 s reload keeps each feed's page count.
- **D5 Column head:** icon, title, the loaded count, `N+` while more pages exist. No other number (PB-7; `questions.md` Q3).
- **D6 Layout.** Below `lg` one stack: overdue, drafted, sent, answered, then the closed list. From `lg` an `auto-fit` grid of columns of at least 16 rem (two to four columns; no new breakpoint, DB-6). A column has an `h2` and a list named by it.
- **D7 URL.** `?filter=` is read once at load: `closed` opens the closed list; other values change nothing (default: Q5). The page writes no URL (DB-1).
- **D8 Closed list** under the columns, behind an `aria-expanded` button; rows keep the status badge.
- **D9 Focus after a reload.** A focused row that moved to another column keeps the focus on its new card. A row gone from every group gives `dgn_moved` and the focus on the status line, as today.
- **D10 Errors.** A 404 from any feed shows `dlg_off`; another failure, a Retry in that feed's columns only.
- **D11 Actions do not change:** who may do what, the remind limits and reasons, the cancel dialog, the status line texts.
- **D12 Open loops, Delegated tab.** With `delegation_pages` on: the columns, then the delegated loops under their heading with their own filter links (Open, Due today, Closed). On this tab `?filter=` is the loop filter; `closed` also opens the closed delegations. Rejected: loops that follow a column.
- **D13 Page head.** Each island passes one lead key (one `/delegations` lead fits both views) and, as the action, `DelegationSwitch` (stage 02), which renders nothing without `delegation_pages`, as the tabs do today. No shell change (§ Rules for width, rule 3).
- **D14 `PillNav`,** one page-local component (`components/delegation/PillNav.tsx`) for link tabs with `aria-current`: the page switch, the loop tabs, the loop filters. Rejected: a new shared pattern (F166 owns `components/patterns/`).
- **D15 Delegates.** Cards with `InitialsAvatar`, no counts (PB-7). The add form stays on the page; a dialog would change behaviour (PB-5).
- **D16 Rule sentence.** One text key per language gives the sentence and the order of its slots `{pattern}`, `{kind}`, `{scope}`. Stage 07.
- **D17 Rule remove.** Delete at once, as today; the toast offers Undo for 10 s, which posts the same rule again (default: Q1). Stage 08.
- **D18 Texts.** No page gets more than 20 new keys, so no new group file. Keys sit next to their page's keys (`texts/*-approvals.ts` for delegations, delegates, loops and the page titles; `texts/*-settings.ts` for rules); each stage names its spot so parallel stages do not touch one place. A key nothing reads goes in the same stage (DB-10). Emoji leave these pages' texts.
- **D19 Docs ownership.** `delegate-and-follow-up.mdx` (en, pl): stage 03 (it also fixes the stale line "You cannot add a delegate in the panel"). `sender-rules.mdx` (en, pl): stage 06 makes the sections "Add a rule" and "Remove a rule"; stage 07 edits only the first, stage 08 only the second (a deliberate exception to rule 1: separate sections merge cleanly). Stages 04, 05, 09, 10 change no user docs page. Each stage updates its part of `docs/capabilities/web-panel.md` rule 9, one long shared line: on a land conflict, merge master and prove again.
- **D20 The demo.** Stage 03 changes only the locators of step 7 of `apps/web/e2e/demo/record.spec.ts`; it records nothing (F171 records).
- **D21** A gap or a deviation is a question in the final message.

## Facts checked (2026-11-23, at 8c9acfc1e)

- Statuses `drafted, sent, answered, overdue, done, cancelled` (core `web/delegation.ts`, DB CHECK). Server map `open → drafted+sent`, `closed → done+cancelled` (`delegation/list.ts`); page size 50; the e2e seed has every status (`e2e-seed/args-delegations.ts`).
- Only the web writes `/delegations?filter=`; server links use `?tab=`.
- `MeProvider` sits inside `AppShell`, so an `action` node can call `useMe()`.
- Rules remove today: `DELETE` at once, a toast, no Undo, no question. `POST /api/rules` answers 409 `rule_exists` and `rule_limit`; `RuleView.mailboxId` is nullable.

## Not verified

- Whether `ui:sheet` has states with `open_loops` or `urgency_editor` on: stages 04 and 09 check, else use the e2e pictures.
- The Polish sentence reads well to a native speaker: Q2.

## Done when

The six acceptance items of [`ticket.md`](ticket.md) hold: item 1 by stage 01 tests 1–2; item 2 by stage 03 test 4; item 3 by stage 03 test 3; item 4 by stage 03 tests 2 and 5; item 5 by stage 07 tests 1 and 4; item 6 by stage 08 tests 4–5.

## Rules for every stage

- Read the programme page, this file, F166 `interfaces.md` and your stage file.
- Token classes only (DB-2). No `h1` in an island (DB-9). No URL, API, schema, migration or `bun.lock` change (DB-1).
- Edit only your stage's files; `components/ui/`, `components/patterns/`, `global.css`, `components/shell/` and `nav-items.ts` are not yours (rule 3). Format only your files.
- Keep every `data-*` attribute, `id` and accessible name that a spec or another page uses, unless your stage names the change.
- Run `UI_SHEET_ROUTES=<your routes> bun run ui:sheet`, open phone and desktop in both schemes and languages, and give the paths in the final message.

## Proof

- **Proof A** (stage 01): `mkdir -p /tmp/f169-NN && bun run check:job > /tmp/f169-NN/check.log 2>&1 && echo PROOF_OK`
- **Proof B** (stages 02–10): `mkdir -p /tmp/f169-NN && bun run check:job > /tmp/f169-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f169-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts <the stage's specs> patterns.spec.ts > /tmp/f169-NN/e2e.log 2>&1 && echo PROOF_OK`

## User checkpoints and steps

None. The owner sees the full contact sheet before the release (PB-12, F172).

## Review

A review job before the land of stages 02–10. Opus where the stage adds Polish text (02, 03, 05, 06, 07, 08; board rule), Sonnet for 04, 09, 10. The task adds the picture check of F166 § Review. Stage 01 lands on its proof.

## Stages

| # | Stage | Needs | May run next to |
| --- | --- | --- | --- |
| 01 | [Columns model and feeds](stages/stage-01-columns-model.md) | F166 03 | 02, 05–10 |
| 02 | [Page head and page switch](stages/stage-02-page-switch.md) | F166 03, 08, 09 | 01, 06–10 |
| 03 | [Delegations as columns](stages/stage-03-delegation-columns.md) | 01, 02; F166 03, 10 | 05–10 |
| 04 | [Open loops board look](stages/stage-04-open-loops-look.md) | 02, 03; F166 03, 06, 10 | 05–10 |
| 05 | [Delegates look](stages/stage-05-delegates-look.md) | 02; F166 03, 06, 09, 10 | 01, 03, 04, 06–10 |
| 06 | [Rules frame](stages/stage-06-rules-frame.md) | F166 03, 08, 09 | 01–05, 09, 10 |
| 07 | [Rule sentence form](stages/stage-07-rule-sentence.md) | 06; F166 03, 10 | 01–05, 08–10 |
| 08 | [Rule chips and Undo](stages/stage-08-rule-chips.md) | 06; F166 03, 10 | 01–05, 07, 09, 10 |
| 09 | [Urgency card look](stages/stage-09-urgency-card.md) | F166 03, 10 | all |
| 10 | [Suggestions and newsletters look](stages/stage-10-suggestion-cards.md) | F166 03, 10 | all |

No stage is `[risky]`.

## How to run (coordinator)

As F166 § How to run (one job per stage, board worker flags, `--prepare 'bash scripts/limen-prepare.sh'`). Start every stage whose Needs are met. Land each with `limen land <job> --yes --keep-open`, the last without; drop its job DB.

## Planning progress

Scouts: 4 (`scouts.md`). Stages 01–10 [written]. Words (`wc -w`, after review 1): plan 1,497; stages 415–700.

## Cold review

Sonnet (no `[risky]` stage). Fix before build (3 blocking, 7 minor); answers: `plan-review-1.md` § Response.

## Log

- 2026-11-24: plan written.
- 2026-11-24: review 1 fixed (`plan-review-1.md` § Response).
