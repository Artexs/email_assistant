# F095 · E1 Close the MVP: plan

> **Status 2026-11-14 — planned.** Ten stages written; cold review 1 done (see "Cold review"). Nothing is built yet. Stage 09 must not start before 2026-11-14T22:40Z. Stage 10 needs the owner's phone (U1).

Ticket: [ticket.md](ticket.md). Small questions with their defaults: [questions.md](questions.md). Epic page: `docs/product/stage-2/epics/E01-close-the-mvp.md`. The ticket names `E01-discovery-notes.md`: that file does not exist (E1 had no discovery, `05-execution-plan.md` §3).

## Planning progress

- [x] Collect: handoff `~/.pi/agent/notes/2026-11-12-handoff-stage2-e01-close-the-mvp.md`, epic page E01, `05-execution-plan.md` §1–§4, `07-foundation-plan.md`, `06-architecture-review.md` §3.14, §3.17, §5, §8, `decisions.md` (PD-001, PD-007, PD-009, PD-100), `02-inventory-and-roadmap.md` §2 and §7, `spec/build.md`, `spec/features/planned/triage-2026-11-13.md`, F037, F047, F077 (stage 18, deploy log), the docs (`architecture.md`, `roadmap.md`, `product-brief.md`, `spec/vision.md`, `docs/decisions/README.md`), the module folders, `main.ts`, `retention.ts`, the migrations.
- [x] Facts checked (F1–F12).
- [x] Decisions P1–P4, D1–D22.
- [x] stage-01-boundary-docs [written]
- [x] stage-02-capability-frame [written]
- [x] stage-03-cap-sync-triage [written]
- [x] stage-04-cap-actions-undo [written]
- [x] stage-05-cap-drafts-send-delegation [written]
- [x] stage-06-cap-notices-panel [written]
- [x] stage-07-cap-tenancy-retention-backups [written]
- [x] stage-08-sweep-and-next [written]
- [x] stage-09-pilot-results [written]
- [x] stage-10-delegation-round-trip [written]
- [x] Cold review (`plan-review-1.md`), fixes logged in "Cold review".

## Input

### The owner's words, word for word

From the handoff (2026-11-12):

> "Ultimately the MVP is almost already finished and I am thinking about another roadmap for this project."
> "okay, looks like the plan is approved and it's fine to implement it, right?"
> "So prepare me a hand off for first epic and I will proceed with it. Then in another conversation I will ask for handoff for next epic and so on. So right now prepare me a hand off and start it. That's my confirmation."
> "I should go epic by epic and design and prepare the plan for each of them"

PD-001 (owner): "make it to the point where it will be just standalone product ready to sell. However, I am not going to sell it".

The planning job's task (2026-11-13): "Owner rules: no owner checkpoints for confirmation; list an owner step only for what needs the owner's hands (VPS, real secrets, real money); small questions get a default in questions.md."

`spec/build.md` NEXT (owner decisions 2026-11-13): "Owner checkpoints and owner steps (U1, U2, ...) are NOT a stop"; "VPS, ssh and deploy steps are pre-approved; the coordinator does them (backup first, name the rollback target, verify after). Stop for the owner only when a step needs an API key or secret the coordinator cannot get itself."

### The epic page, word for word (In scope and Exit)

> - F077 stage 18: S6a checkpoint and VPS deploy with the owner's go.
> - F037 and F047 part B on 2026-11-14 (one-week counts); F047 part A: one real delegation round trip on the phone (about 15 min).
> - Docs agree on the boundary (PD-001): apply the `02` §7 text to `spec/vision.md` (owner-owned: propose, then apply with OK) and `docs/product-brief.md` Q1; `docs/roadmap.md` §1 and §5 updated.
> - `spec/build.md` NEXT gets an order for the 34 planned tickets: keep, fold into an epic, or drop. Move `tasks/active/s6-pre-sale.md` and `tasks/planned/s6*` references into E7.
> - Capability map (PD-009): one page per capability (sync, triage, actions and Undo, drafts and send, delegation, digest and notices, web panel, tenancy and plans, retention, backups): what it does now, rules, entry points, limits, ADR links. Built from `02` §2 and the code.
> - Optional (PD-007): five conversations with target executives (mail provider, volume, what they fear to miss, who handles their inbox). Result as a note.
>
> Exit:
> - F077 landed and deployed; F037, F047 A and B results in their tickets.
> - `grep -l "SaaS for sale\|first external customer" docs/*.md spec/vision.md` returns nothing stale.
> - `docs/capabilities/` exists with one page per capability; `spec/build.md` NEXT lists every planned ticket with its epic or "dropped".

The 02 §7 text that PD-001 approves, word for word:

> `spec/vision.md`, "Current direction", first bullet:
> > Goal (owner, 2026-11-12): a sell-ready product that is not sold. It is built, tested, documented and operated as a real product for other people, but it runs only on the owner's home VPS for the owner and test organizations. No real customer, billing account, company or lawyer. Each feature must meet the bar a paying customer would set.
>
> `docs/product-brief.md` Q1: append
> > Changed 2026-11-12: sell-ready, not sold (see `spec/vision.md`). The product must be ready for outside users; no outside user is served.

`06-architecture-review.md` §3.14 recommendation, word for word: "the E1 capability-map ticket also moves behaviour out: §4.1 rules 6–8, §4.4, §4.5, §4.6 job details and §8 into `docs/capabilities/<capability>.md`, with one link line left behind. `architecture.md` keeps goals, context, layout, module rules, ports, invariants, data model, security, deployment. Generate the module graph (§3.2) and drop `code-map.md` or regenerate it per release."

### Product decisions (from the owner's decision rows; not re-opened)

- **P1 Boundary (PD-001).** Sell-ready, not sold. The 02 §7 text goes in word for word. Other stale lines get the smallest change that agrees with it (D14, D15).
- **P2 Capability map (PD-009, PD-100).** One page per capability; agent-facing, not on the docs site; the rule "a landed feature updates its capability page in the same change", and once E10a exists also its user doc page (en).
- **P3 PD-007 stays the owner's call.** The five conversations are not a stage. E1 closes without them. Default, owner to confirm (Q6).
- **P4 E1 adds no feature** (epic page "Out of scope"). The only code is one unit test that keeps the capability map true (D3).

### Design decisions (D1–D22)

"Default, owner to confirm" marks a small question that is also in [questions.md](questions.md). The stages do not change with its answer.

- **D1 Ten pages, fixed file names.** `docs/capabilities/` holds `README.md` (index and rules) and exactly these pages: `sync.md`, `triage.md`, `actions-and-undo.md`, `drafts-and-send.md`, `delegation.md`, `digest-and-notices.md`, `web-panel.md`, `tenancy-and-plans.md`, `retention.md`, `backups.md`. Why: the epic page names these ten. A new capability later adds a page and an index row in the same change.
- **D2 Page template.** Every page has, in this order: `# <Title>`; one line `> Checked against the code at \`<7+ hex sha>\`, YYYY-MM-DD.`; then the seven sections `## What it does now`, `## Rules`, `## Entry points`, `## Data`, `## Limits`, `## Decisions`, `## Tests`. Content rules:
  - "What it does now": 3–8 sentences, user and operator view. Only behaviour that the code at the checked commit has.
  - "Rules": numbered behaviour rules (condition → result). Text moved from `architecture.md` keeps its wording (D4).
  - "Entry points": one table `| Kind | Name | Where |`. Kinds: `job` (job name and schedule from `apps/server/src/main.ts`), `CLI` (`bun run <script>`), `route` (`METHOD /api/...`), `Telegram` (command or callback prefix), `function` (an export of a module `index.ts`), `page` (web island). "Where" is a repo-root path in backticks, without a line number.
  - "Data": tables and columns the capability writes; its status flows (moved from §4.6).
  - "Limits": what it does not do now, known gaps, and the ticket or epic that changes it (by F-number from `05-execution-plan.md` §2.1 or the folder name).
  - "Decisions": ADR links (`ADR NNNN`) and PD rows.
  - "Tests": the main test files (repo-root paths).
- **D3 A unit test keeps the map true.** `apps/server/src/capability-map.test.ts` (next to `main.test.ts`; `bun run test:unit` covers `apps/server/src`). It checks: (1) `README.md` lists every page file of the folder and no missing file; (2) each page has the H1, the "Checked against" line and the seven `##` headings in order; (3) every backticked token that starts with `apps/`, `packages/`, `db/`, `deploy/`, `docs/`, `tools/`, `scripts/`, `evals/` or `spec/` exists (after it strips a `:<digits>` suffix and a `#anchor`); (4) every `bun run <name>` names a script of the root `package.json`; (5) every `ADR NNNN` has a file `docs/decisions/NNNN-*.md`. Why: the map is the baseline for every later plan; a renamed file must fail a test, not mislead a planner. Rejected: a CI script outside the unit suite (one more thing to wire); a check of every claim (not possible).
- **D4 Move, do not rewrite.** The behaviour text of `docs/architecture.md` §4.1 rules 6–8 (detail), §4.4, §4.5, §4.6 and §8 (detail) moves into the pages with its wording. A worker changes only the cross-references inside the moved text (`§4.5` → the page link) and facts that the code at the base commit contradicts (each one listed in the final message). Why: the text was reviewed many times; a rewrite loses rules.
- **D5 What stays in `architecture.md`.** §1–§3; §4.1 the flow diagram, rules 1–5 whole, and for rules 6–8 the first sentence (the bold headline) plus one link line; §4.2 and §4.3 whole; §4.4, §4.5 and §4.6 keep their headings with one link line each; §5, §6, §7 whole; §8 keeps the bullets Scheduler (as a job list: name, schedule, page link), Work queue, Liveness, `GET /health` and Logging; the other §8 bullets move (D19); §9–§12 whole. Why: inbound references (`architecture.md §4.1 rule 6`, `§4.5`, `§8`; 48 hits in `docs/`, code comments, `deploy/`) still resolve to a heading that points to the page. Rejected: delete the headings (breaks the references); edit every code comment (mass edit forbidden, `docs/code-patterns.md` § Style).
- **D6 Inbound references.** A stage that moves a section changes the references to it in `docs/*.md`, `docs/modules.md`, `deploy/README.md`, `README.md`, `CLAUDE.md` and `.agents/limen/styleguide.md` to the page. It does not edit `docs/decisions/*` (accepted ADRs are never edited), `docs/product/stage-2/*`, `spec/features/done/`, `spec/features/dropped/`, `notes/` or code comments: the link line in `architecture.md` serves them.
- **D7 Pages state the code, not the plan.** A worker checks each claim it writes against the code at its base commit (`git rev-parse --short HEAD`, the sha of the "Checked against" line). A claim of `02` §2 that the code does not hold is not copied; the final message lists it. Plans go only to "Limits", with the F-number.
- **D8 Capability stages run one at a time.** Stages 01, 03–07 all edit `docs/architecture.md`. Stage N+1 starts after stage N lands. Stage 08 and stage 09 may run in parallel with stages 03–07 (no shared file; see "How to run").
- **D9 NEXT block, applied by the coordinator.** Stage 08 writes the full proposed NEXT section body into `next.md` in this ticket folder. The coordinator replaces the `## NEXT` body of `spec/build.md` with it after the land. Why: `spec/build.md` NEXT is coordinator prose (its header), and other tickets edit it at the same time. Default, owner to confirm (Q8).
- **D10 NEXT line form.** One line per folder in `spec/features/planned/` and `spec/features/active/` at the stage's base commit, in this order: active tickets first, then the Stage 2 tickets in `05-execution-plan.md` §2.1 order (# 0 to # 28), then the older tickets. Form (§2.3 step 3, with the epic): `` - `FNNN-slug` (🟠 ACTIVE | 🔴 PLANNED[, needs plan | , plan landed]): <outcome, one clause>; epic <E-id or "none">; sequenced after <F-numbers or —>; gate <gate or —>. `` An older ticket gets one of the verdicts `keep`, `folded into <F-number>`, `parked` or `drop` (with the reason, one clause). After the lines come the standing rule bullets of the current NEXT (start rule, planning rule), unchanged, without the line "E1 Close the MVP (§2.1 row 1): not planned yet …". Source of the verdicts: `spec/features/planned/triage-2026-11-13.md` and the epic pages; a ticket that a verdict there closes but that is still in `planned/` (F056: F082 stage 15 closes it) gets `folded into F082`.
- **D11 Sweep verdicts (06 §3.17).** Keep `.cursor/rules/`, `.windsurfrules`, `.github/copilot-instructions.md` (F070 made them pointers to `CLAUDE.md`; they cost nothing); keep `.omp/`, `.pi/` (the Limen extensions), `.claude/skills/vps-ssh`, `.ai/` (history that `CLAUDE.md` names) and `tasks/` (the E7 plans read it). Delete `docs/diagrams/code-map.md` and `code-map.html` (they describe S1a; `docs/diagrams/module-graph.md` is generated by `bun run graph:modules`). Add rows to `docs/decisions/README.md` for 0018–0020 ("reserved by the S6 plan, `tasks/active/s6-pre-sale.md`; E7 tickets F106–F108 use or release them"), 0025 ("not used"), 0034 and 0035 (proposed, title from the file). No placeholder ADR files. Default, owner to confirm (Q9).
- **D12 The S6 task files point to E7.** Each file in `tasks/active/` and `tasks/planned/` gets one status line under its H1: `> **Moved 2026-11-NN:** <segment> is now <F-number folder>. This file is history; the ticket decides.` Map: `s6b-public-login.md` → `F082-s6b-public-login` (active); `s6c-account-data.md` → `F106-e7-t3-account-data-delete-export-dsr`; `s6e-papers-cost.md` → `F107-e7-t4-papers-and-cost`; `s6f-hosted-production.md` → `F108-e7-t5-production-on-the-vps`; `s6-pre-sale.md` → "S6a = F077 (done), S6b = F082, S6c = F106, S6e = F107, S6f = F108; other Stage 2 work: `docs/product/stage-2/05-execution-plan.md` §2.1". `CLAUDE.md` § Work, the bullet "Not moved yet: …" becomes: `` - The old S6 files in `tasks/` are history: S6a = F077 (done), S6b = F082, S6c = F106, S6e = F107, S6f = F108. `` The `tasks/` folder itself stays.
- **D13 Pilot runs read the VPS read-only.** Stage 09 runs `ssh home_vm` with read-only commands only: `git rev-parse`, `git merge-base --is-ancestor`, `docker compose … ps`, `logs`, `exec -T db psql … -c "select …"`, `exec -T server bun run org:status`, `exec -T server bun run triage:cost --days 7`, `exec -T server bun run mailbox:audit --since …`. No `update`, `insert`, `delete`, restart, deploy or `.env` read. Results hold counts, ids of the pilot org and mailbox, codes and dates only: never an address, a subject, a name or mail text. Why: pre-approved VPS access covers reads; the pilot mail is private.
- **D14 Vision text (owner-owned file).** Stage 01 applies the PD-001 bullet word for word as the first bullet of "Current direction", and the four smallest changes that remove the contradictions, with the exact text of stage 01 step 1. Why: PD-001 says "E1 applies it"; the file says the coordinator "does not invent or rewrite this intent unprompted", and PD-001 is the prompt. The owner may change or revert the lines at any time. Default, owner to confirm (Q2).
- **D15 Boundary edits are a fixed list.** The exit grep of the epic page misses real stale lines and hits others (handoff state check, item 4). Stage 01 edits exactly the lines of its table; its check is a grep with an expected result, not the epic grep alone.
- **D16 Week windows have an end.** The F037 and F047 B queries count from `<START>` to `<START> + 7 days` (`and <column> < '<START>'::timestamptz + interval '7 days'` next to each `>= '<START>'`). Why: the queries run days after the week; without the end the counts hold extra days. The old step text had no end because it ran at the end of the week.
- **D17 F037 with N > 3.** If N (wrong moves of real mail) is above 3, stage 09 records it, changes no setting, and the result line says "S3 bar missed: N = <n>; follow-up in E3a (F100) and E3b (F109)". The owner may later turn a category off. Default, owner to confirm (Q3).
- **D18 F047 B owner answers.** Wrong drafts and injection incidents need the owner's own count. Stage 09 writes the SQL part (rejected sends) and "owner count: asked at stage 10" ; stage 10 asks the owner during the U1 session and writes the answer. F047 B4 ("keep `SEND_SCOPE=all`?"): default keep the current VPS settings, no change (Q5).
- **D19 §8 bullets go to these pages.** Mailbox errors → `sync.md`; S3 jobs (committer, `triage.returned`) → `actions-and-undo.md`; S4 jobs: `actions.expiry` → `drafts-and-send.md`, `delegation.chaser` → `delegation.md`; S2 jobs (`channels.notifier`, `channels.digest`), Notices, Operator notices → `digest-and-notices.md`; Plan state, Feature flags → `tenancy-and-plans.md`; Backups → `backups.md`; the retention job sentence → `retention.md`. The Scheduler bullet stays as a job list with a page link per job (D5).
- **D20 F077 is recorded, not redone.** F077 is in `done/` (landed 2026-11-13) and was deployed on 2026-11-12 (`notes/2026-11-12-s6a-deploy-log.md`). Stage 09 checks that the VPS runs a commit that contains `cab134f`, reads the pilot health (D13), and appends the result to that note. It does not edit the done ticket.
- **D21 F047 part A is the one owner step (U1).** The owner's phone and Gmail are needed; the coordinator runs the VPS reads and the two writes that F047 `plan.md` A2 names (the `due_at` update of the test delegation and `job:run --name delegation.chaser --force`, pre-approved VPS steps). Stage 10 holds the runbook and the record step.
- **D22 E1 closes after U1.** The epic exit needs the F047 A result. The coordinator asks for U1 when F095 starts (it is the gate of `05-execution-plan.md` §2.1 row 1), so it runs in parallel with stages 01–09. If the owner has not done U1 when stage 09 has landed, E1 waits. Default, owner to confirm (Q7): the alternative is to land E1 without U1 and keep F047 open with part A only.

## Facts checked

- **F1** F077 is in `spec/features/done/2026-11/` (front matter `landed: 2026-11-13`). The VPS deploy ran 2026-11-12 at `cab134f`; rollback target `8f6a8b2`; open after it: one day of the pilot (digest, triage, error count). Source: `notes/2026-11-12-s6a-deploy-log.md`, read 2026-11-14.
- **F2** F037 `<START>` = 2026-11-07T19:55:16Z, blocked until 2026-11-14T20:00Z; F047 `<START>` = 2026-11-07T22:40:00Z, part B blocked until 2026-11-14T22:40Z; part A open since 2026-11-08. Pilot org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`. Source: the two `plan.md` files, read 2026-11-14.
- **F3** The query text lives in `spec/features/done/2026-11/F005-s3-assist-actions/stages/stage-20-one-week-assist-run.md` step 20.2.3 and `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/stages/stage-23-first-real-delegation.md` step 23.2.3; the A runbook in `stage-22-vps-deploy-self-send.md` step 22.2. Read 2026-11-14.
- **F4** The columns the queries use exist at `9d9bfb8`: `emails.message_id_header`, `emails.from_address` (`db/migrations/20261103100001_mail.sql:48,56`), `emails.source_folder` (`20261109083501_sync_folders.sql:26`). Outbox changed later (`20261113100001_outbox_view.sql`); stage 09 checks the outbox query against the live schema first.
- **F5** The retention job clears texts, never rows: mail headers and texts after 90 days, bodies after the organization's `data_retention_days` (`apps/server/src/retention.ts:19,79-94`). So the week rows still exist for the queries.
- **F6** `docs/architecture.md` (814 lines at `9d9bfb8`) sections: §4.1 rules 6–8 lines 134–229, §4.4 287–320, §4.5 322–365, §4.6 367–414, §8 694–735. 48 inbound references to `architecture.md §…` outside `docs/product/stage-2/` (grep, 2026-11-14). Three code comments reference §4.5, §6.1 and §7 (`actions/repo.ts:1678`, `channels/callbacks.ts:192`, `mail/sync-rules.ts:6`). No test reads `architecture.md`.
- **F7** Other tickets edit `docs/architecture.md`: F082 stage 13–14 (§5 event list, §7), F088 stage 07 (§5 outbox row, §7), F091 stage 05 (reviews §4.6 and `docs/modules.md` §3.5). Only F091 stage 05 touches a section that E1 moves. Source: grep of `spec/features/active/*/stages` and `planned/F091*/stages`, 2026-11-14.
- **F8** `apps/server/src/modules/layers.test.ts` reads repo files from a unit test (`graphPaths(path.resolve(import.meta.dir, "../../../.."))`). `test:unit` covers `apps/server/src` (root `package.json`). So a unit test under `apps/server/src/` can read `docs/`.
- **F9** Markdown files are formatted by lint-staged on commit (`"*.{json,css,md}": ["prettier --write"]`, root `package.json`). On `master` `d117cd6`, `bunx prettier --check` warns on `docs/product-brief.md` and `docs/decisions/README.md` (2026-11-14): the first commit of a stage that edits them reformats the whole file.
- **F10** Stale boundary lines (grep 2026-11-14 at `9d9bfb8`): `spec/vision.md:7,15,22,23,24`; `docs/product-brief.md:17,33,51,60,63`; `docs/architecture.md:11,625,780,797`; `docs/roadmap.md:27-30,52,136`; `docs/modules.md:340` (`billing` module "Plans, payments, limits (S6)"; PD-047 dropped billing). Stage 01 lists the exact edits.
- **F11** ADR files: 0001–0017, 0021–0024, 0026–0035. Missing: 0018–0020 (reserved by the S6 plan, `docs/decisions/0021-simulator-stack.md:5`), 0025 (no reference anywhere). The index lacks 0034 and 0035. Source: `ls docs/decisions`, grep, 2026-11-14.
- **F12** The older planned tickets and their verdicts: `spec/features/planned/triage-2026-11-13.md` (35 tickets). Since then 16 were dropped and F034 closed (`ee3443e`), F030 and F078 moved to `active/`, F078 landed (`ffc6179`, master 2026-11-14). The E04 notes §5 line for E1 (close F034, fold F039 and the F075 web half, F055 stays) is applied by `ee3443e`.

## Not verified

- **NV1 A worker job can `ssh home_vm`.** No worker stage has used ssh before (the deploys were coordinator or owner steps). Stage 09 step 1 checks `ssh -o BatchMode=yes -o ConnectTimeout=10 home_vm true` first. If it fails: the worker stops and reports; the coordinator runs the commands of stage 09 itself and passes the outputs with `limen continue <job> "<outputs>"`.
- **NV2 The VPS log form.** The VPS ran `cab134f` (before F089 structured logs) on 2026-11-12; a later deploy (F094 stage 2) may have moved it to the JSON event form. Stage 09 reads `git rev-parse --short HEAD` on the VPS and `git merge-base --is-ancestor <F089 land commit> HEAD` and picks the grep of its step 2 table.
- **NV3 The week queries run unchanged on today's schema.** Stage 09 runs each query; on an error it reads the migrations, fixes the column or kind name, and records the changed query in the result.
- **NV4 `bun run mailbox:audit --since` and `triage:cost --days 7` still take these flags.** Stage 09 runs `--help` or reads the script args file first.

## Done when

1. `docs/capabilities/` holds `README.md` and the ten pages of D1; `bun run test:unit:ci` passes with `apps/server/src/capability-map.test.ts`.
2. `docs/architecture.md` keeps the D5 frame: the moved sections are link lines (`grep -c "Moved to \[\`docs/capabilities/" docs/architecture.md` ≥ 14), and §8 keeps exactly the five D5 bullets (stage 07 step 4).
3. The boundary grep of stage 01 step 3 returns exactly the expected lines.
4. `docs/code-patterns.md` and `.agents/limen/styleguide.md` hold the PD-009 / PD-100 rule.
5. `next.md` in this folder lists every folder of `planned/` and `active/` with its epic or verdict (D10); the coordinator has put it into `spec/build.md` NEXT.
6. F037 and F047 `plan.md` § Results hold the week tables (counts only); F047 § Results holds the part A facts; `docs/roadmap.md` S3 and S4 state lines hold the results; F037 and F047 are in `done/` (coordinator `limen ticket done`).
7. `notes/2026-11-12-s6a-deploy-log.md` holds the F077 day check (stage 09).
8. The S6 task files and `CLAUDE.md` point to the E7 tickets (D12); the ADR index has no hole (D11).

## Rules for every stage

- **A gap or a deviation is a question in the final message, not a choice.** When the code contradicts the plan, or a file moved, stop at that point, write what you found, and finish. The coordinator decides from "Input" or asks the owner.
- **Format only the stage's files.** Never run `bun run format` or `prettier --write .`. Run `bunx prettier --write <the files you changed>` before the commit (lint-staged does the same on commit).
- **Commit with explicit paths.** Never `git add -A` or `git add .`. Review `git diff --staged` before each commit (`CLAUDE.md`).
- **Private data.** No mailbox address, subject, sender name, delegate address, mail text, token or `.env` value in any file, log, commit message or final message. Ids of the pilot org and mailbox, counts, codes and dates are fine. The test-mail sender address may appear in a SQL filter, never in a result.
- **No VPS write and no deploy in a worker stage.** Only stage 09 touches the VPS, read-only (D13).
- **Do not edit** `spec/build.md`, `spec/features/done/**`, `spec/features/dropped/**`, `docs/product/stage-2/**`, `docs/decisions/0*.md`, or another ticket folder, except the files a step names: F037 and F047 `plan.md` (stages 09, 10), and one result line each in the § Log of F005 and F006 `plan.md` (stages 09, 10; F037 and F047 name it as the one allowed edit of a done file).
- **Pages state the code** (D7). Read the code you describe. "Checked against" carries `git rev-parse --short HEAD` of your base commit and today's date.
- **Merge first.** Start each stage with `git log --oneline -1` and `git log --oneline <plan commit>..HEAD -- docs/architecture.md` (plan commit: the last commit of this folder, `git log -1 --format=%h -- spec/features/active/F095-e1-close-the-mvp/plan.md`). Move the newest text of a section, not the text of this plan's line numbers.
- **Line numbers in this plan are hints** (taken at `9d9bfb8`). Find text by its words.

## Proof

One `&&` chain, run after the last commit, with nothing after it. Read the logs in a separate call. `<files>` = every Markdown file the stage changed (`git diff --name-only $(git merge-base HEAD master) -- '*.md'`), written out by name.

Stages 01, 03–10:

```
mkdir -p /tmp/f095-sNN && bunx prettier --check <files> > /tmp/f095-sNN/prettier.log 2>&1 && bun run lint > /tmp/f095-sNN/lint.log 2>&1 && bun run test:unit:ci > /tmp/f095-sNN/unit-ci.log 2>&1 && echo PROOF_OK
```

Stage 02 (it adds a test file):

```
mkdir -p /tmp/f095-s02 && bunx prettier --check <files> apps/server/src/capability-map.test.ts > /tmp/f095-s02/prettier.log 2>&1 && bun run lint > /tmp/f095-s02/lint.log 2>&1 && bun run typecheck > /tmp/f095-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f095-s02/unit-ci.log 2>&1 && echo PROOF_OK
```

No stage changes server code or the DB, so `test:int` is not part of the proof. A reviewer may run it.

## User checkpoints

None. The owner's rule: no checkpoint for review or confirmation.

## User steps

| Id | What | When | Who |
| --- | --- | --- | --- |
| U1 | F047 part A: one real delegation round trip with the owner's Gmail and phone, about 15 minutes, outside quiet hours 22:00–07:00 Warsaw (stage 10 runbook). | Ask when F095 starts; any time before stage 10 | Owner (mail and taps), coordinator (VPS reads and the two pre-approved writes) |

The owner may answer the small questions in `questions.md` at any time; the build uses the defaults until then.

## Review

Every stage gets one review job before the land (reviewer: the board's standing model, `spec/build.md` § TRACK; `--review --branch <job branch>`). Why: the capability pages are the baseline that every later plan reads; a wrong page costs more than a review. Focus per stage is in the stage file ("Review focus"). At most two review rounds, then the coordinator decides.

## Stages

- [ ] Stage 01 — boundary docs (PD-001), vision bullet, roadmap state — [`stages/stage-01-boundary-docs.md`](stages/stage-01-boundary-docs.md)
- [ ] Stage 02 — capability map frame: index, template, rule, the map test — [`stages/stage-02-capability-frame.md`](stages/stage-02-capability-frame.md)
- [ ] Stage 03 — pages `sync.md`, `triage.md`; move rule 7 (triage part), rule 8, §4.4 feedback part, §4.6 `emails` flow, §8 mailbox errors — [`stages/stage-03-cap-sync-triage.md`](stages/stage-03-cap-sync-triage.md)
- [ ] Stage 04 — page `actions-and-undo.md`; move rule 6 (idempotent part), rule 7 (committer part), §4.4 Undo and moved back, §4.6 `actions` flow, §8 S3 jobs — [`stages/stage-04-cap-actions-undo.md`](stages/stage-04-cap-actions-undo.md)
- [ ] Stage 05 — pages `drafts-and-send.md`, `delegation.md`; move rule 6 (drafts, send), §4.5, §4.6 delegations, §8 S4 jobs — [`stages/stage-05-cap-drafts-send-delegation.md`](stages/stage-05-cap-drafts-send-delegation.md)
- [ ] Stage 06 — pages `digest-and-notices.md`, `web-panel.md`; move §8 S2 jobs, notices, operator notices — [`stages/stage-06-cap-notices-panel.md`](stages/stage-06-cap-notices-panel.md)
- [ ] Stage 07 — pages `tenancy-and-plans.md`, `retention.md`, `backups.md`; move the rest of §8; final shape of `architecture.md` — [`stages/stage-07-cap-tenancy-retention-backups.md`](stages/stage-07-cap-tenancy-retention-backups.md)
- [ ] Stage 08 — sweep: `next.md`, S6 task files, `CLAUDE.md`, ADR index, `code-map` — [`stages/stage-08-sweep-and-next.md`](stages/stage-08-sweep-and-next.md)
- [ ] Stage 09 — pilot results on the VPS (read-only): F077 day check, F037 week, F047 part B — [`stages/stage-09-pilot-results.md`](stages/stage-09-pilot-results.md)
- [ ] Stage 10 — F047 part A round trip (U1) and the E1 close checks [risky] — [`stages/stage-10-delegation-round-trip.md`](stages/stage-10-delegation-round-trip.md)

`[risky]`: stage 10 only (a real mail goes from the owner's address). Stage 09 reads private production data; its review checks the privacy rule.

## How to run (coordinator)

1. Before the first spawn: move the folder (`git mv spec/features/planned/F095-e1-close-the-mvp spec/features/active/`), commit, and ask the owner for U1 (stage 10 "Runbook"; it needs a time slot outside quiet hours). Do not wait for the answer.
2. Spawn one stage (NN two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F095-sNN <slug> · F095" \
     "Implement F095 stage NN. Read spec/features/active/F095-e1-close-the-mvp/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f095-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. Order and parallel lanes:
   - Lane A (serial, all edit `docs/architecture.md`): 01 → 02 → 03 → 04 → 05 → 06 → 07. Land stage N before you spawn N+1.
   - Stage 08 may start after stage 02 lands (it reads the page list for nothing else; it edits `CLAUDE.md`, `tasks/`, `docs/decisions/README.md`, `docs/diagrams/`, `next.md`). Spawn it again late if many tickets moved before its land: `next.md` must match `planned/` and `active/` at the land (its Done when).
   - Stage 09 may start after stage 01 lands (stage 01 edits `docs/roadmap.md`) and not before 2026-11-14T22:40Z (`date -u`).
   - Stage 10 after U1 is done and stages 01–09 have landed.
4. When a job finishes: read its final message and `/tmp/f095-sNN/*.log`. Spawn the review job (§ Review). A finding → `limen continue <job-id> "<fix>"`, then review again.
5. Land: `limen land <job-id> --yes --keep-open` (stage 10: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
6. After the stage 08 land: replace the body of `spec/build.md` `## NEXT` with `next.md` (D9), commit `spec/build.md` alone. If a ticket moved since the stage 08 base, fix its line by hand in the same commit.
7. After the stage 09 land: if NV1 failed, run the stage 09 commands yourself (they are read-only) and pass the outputs with `limen continue`.
8. Stage 10: run its "Runbook" with the owner (U1), write the raw facts as its step 1 says, then spawn the stage 10 worker for the record and close checks. After the land: `limen ticket done F037` and `limen ticket done F047` (their results are in their `plan.md`), then check E1 "Done when" items 1–8 with the commands of stage 10 step 3.
9. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass.

## Cold review

(filled after review 1)

## Log

- 2026-11-14: planned by a `--role planner` job (Opus 5.5), started 2026-11-13, resumed after a quota stop.
