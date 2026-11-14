# F095 stage 08 — Sweep: the NEXT block, the S6 task files, the ADR index, `code-map`

Part of [`../plan.md`](../plan.md). Decisions D9–D12. Read "Rules for every stage" first.

The board gets one ordered NEXT list of every open ticket with its epic or verdict; old pointers lead to the E7 tickets; the ADR index has no hole. Three steps. Docs only. This stage does **not** edit `spec/build.md` (D9).

Base: run `git ls-tree -d --name-only HEAD spec/features/planned/ spec/features/active/` and work from that list, not from this file.

## Step 1 — `next.md` in this ticket folder

- **Goal:** the coordinator can paste one block into `spec/build.md` `## NEXT`, and every open ticket has a line with its epic or verdict.
- **Files:** new `spec/features/active/F095-e1-close-the-mvp/next.md` (the folder is in `active/` while F095 builds).
- **Shape:** first line `# Proposed NEXT body (F095 stage 08, base <sha>, YYYY-MM-DD)`; a blank line; then the lines exactly as they go under `## NEXT`. Line form and order: `plan.md` D10.
- **Source of each line:**
  - Status: `🟠 ACTIVE` for `active/`; `🔴 PLANNED, plan landed` when the folder has `stages/` or an old one-job `plan.md` with a "Done when"; `🔴 PLANNED, needs plan` for a Stage 2 ticket (F096–F122) without `stages/`.
  - Outcome: the clause after `·` in the ticket's H1.
  - Epic and sequencing of the Stage 2 tickets: `docs/product/stage-2/05-execution-plan.md` §2.1 "Needs" and "Gate", with every plan name replaced by its F-number: E1 F095, E8-LR F096, E2a F097, E7-T1 F098, E7-T2 F099, E3a F100, Panel to Astro 7 F101, E4-A F102, E8a F103, E5a F104, E7-T6 F105, E7-T3 F106, E7-T4 F107, E7-T5 F108, E3b F109, E4-B F110, E11b F111, E10a F112, E2b F113, E8b F114, E6a F115, E5b F116, E9a F117, E9b F118, E7-T7 F119, E11a F120, E10b F121, E6b F122. A Stage 2 ticket whose `ticket.md` has a `## Sequenced` section with F-numbers: use that section (it may be newer than §2.1).
  - Foundation tickets still open (F091, F092): their `ticket.md` § Sequenced or `07-foundation-plan.md` §1.
  - Older tickets: the verdicts of this table (from `spec/features/planned/triage-2026-11-13.md` and the epic pages):

| Ticket | Verdict (write it as the line's epic part) |
| --- | --- |
| F023 | `parked`: only if a paid Gemini project exists for the E2a judge (PD-067); epic E3 |
| F029, F032, F064 | `keep`: one sync ticket, plan together after F091 lands (F091 gate on `modules/mail/`); epic none |
| F037, F047 | `folded into F095` (E1 stages 09 and 10 run them; the coordinator closes them) |
| F055 | `parked`: polling is enough (`epics/E04-discovery-notes.md` §5); look again after F101 and F102 |
| F056 | `folded into F082` (its stage 15 closes it) |
| F060 | `folded into F110` (E4-B history check reads the backfill) |
| F062 | `keep`: after F091; one migration at a time |
| F063 | `parked`: trigger is a spam wave in the E3a weekly report (F100) |
| F068 | `keep`: plan after F091 lands (it moves the same writers) |
| F072 | `parked`: out of Stage 2 (PD-067); E3b (F109) degraded-mode notice covers Stage 2 |
| F074 | `keep`: needs the owner (change the panel password, then delete `~/.cache/ea-smoke.pw`); the coordinator deletes `~/email_assistant/.env.bak-s5e` on the VPS (pre-approved) |
| F076 | `parked`: fallback of PD-110 only if OpenAI refuses the EU project (F111 gate) |
| F085 | `keep`: plan after F088 lands (detector registry, outbox migration); epic none |

  - A folder of the base list that is not in this table and not a Stage 2 or foundation ticket: write its line with verdict `keep` and the reason "not in the 2026-11-13 triage", and name it in the final message.
- **After the lines:** the standing rule bullets of the current `spec/build.md` NEXT ("Stage 2 order: …" and "Planning: …"), copied unchanged from the base. Do not copy the bullet "E1 Close the MVP (§2.1 row 1): not planned yet …".
- **Test:** none (docs). Check below.
- **Check:**
  1. Every folder name of the base list appears exactly once: `for d in $(git ls-tree -d --name-only HEAD spec/features/planned/ spec/features/active/ | xargs -n1 basename); do printf '%s %s\n' "$(grep -c "\`$d\`" spec/features/active/F095-e1-close-the-mvp/next.md)" "$d"; done | grep -v '^1 '` → no output.
  2. No line names a plan name instead of an F-number in its "sequenced after" part: `grep -nE "sequenced after[^;]*(E[0-9]+[a-z]?\b|Astro 7)" spec/features/active/F095-e1-close-the-mvp/next.md` → no output, except an epic id inside a gate text (name each one in the final message).
- **Done when:** both checks hold.
- **Out of scope:** `spec/build.md`; the TRACK bullet "Now: S6 pre-sale …" (the coordinator updates it; write the proposed text in the final message: `- Now: Stage 2 (\`docs/product/stage-2/05-execution-plan.md\` §2). The old S6 files in \`tasks/\` are history; their segments are F082 and E7 tickets F106–F108.`).

## Step 2 — The S6 task files and `CLAUDE.md` point to the E7 tickets

- **Goal:** an agent that opens an old S6 file or `CLAUDE.md` finds the ticket that now decides.
- **Files:** `tasks/active/s6-pre-sale.md`, `tasks/planned/s6b-public-login.md`, `tasks/planned/s6c-account-data.md`, `tasks/planned/s6e-papers-cost.md`, `tasks/planned/s6f-hosted-production.md`, `CLAUDE.md`.
- **Edits:** the status line of D12 under each H1 (exact map in D12; today's date for `2026-11-NN`); the `CLAUDE.md` bullet of D12. Change nothing else in these files.
- **Check:** `grep -c "This file is history; the ticket decides." tasks/active/*.md tasks/planned/*.md` → 1 per file (5 files). `grep -n "Not moved yet" CLAUDE.md` → no line.
- **Done when:** the checks hold.
- **Out of scope:** moving or deleting `tasks/` files.

## Step 3 — ADR index and `code-map`

- **Goal:** the ADR index has no hole and lists every file; the stale S1a code map is gone.
- **Files:** `docs/decisions/README.md`, `docs/diagrams/code-map.md` (delete), `docs/diagrams/code-map.html` (delete), each live file that links them (`grep -rln "code-map" --include=*.md . | grep -v node_modules`; leave `docs/product/stage-2/`, `notes/`, `spec/features/done/`, `spec/features/dropped/`).
- **Edits:**
  1. `docs/decisions/README.md` table: rows in number order for `0018`, `0019`, `0020` with title `Reserved by the S6 plan (\`tasks/active/s6-pre-sale.md\`)` and status `reserved (E7 tickets F106–F108 use or release them)`; `0025` with title `Not used` and status `not used`; `0034` and `0035` with the title from the H1 of each file and the status from its `- Status:` line.
  2. `git rm docs/diagrams/code-map.md docs/diagrams/code-map.html`. Replace a live link with `docs/diagrams/module-graph.md` (generated by `bun run graph:modules`).
- **Check:** `ls docs/decisions/0*.md | sed -E 's#.*/([0-9]{4}).*#\1#'` and the numbers in the README table: every file number has a row; the rows 0018–0020 and 0025 have no file. `grep -rn "code-map" --include=*.md docs README.md CLAUDE.md .agents deploy` → no line.
- **Done when:** the checks hold.
- **Out of scope:** ADR files themselves (never edit an accepted ADR); `.cursor/`, `.windsurfrules`, `.github/copilot-instructions.md`, `.omp/`, `.pi/`, `.claude/`, `.ai/` (D11: they stay).

## Review focus

`next.md` covers every folder exactly once (rerun check 1 at the candidate commit); the Stage 2 lines carry F-numbers and match §2.1 "Needs" and "Gate"; the older-ticket verdicts match the table.

## Done when

- Steps 1–3 hold.
- The Proof command of `plan.md` (`/tmp/f095-s08`, files: `spec/features/active/F095-e1-close-the-mvp/next.md tasks/active/s6-pre-sale.md tasks/planned/s6b-public-login.md tasks/planned/s6c-account-data.md tasks/planned/s6e-papers-cost.md tasks/planned/s6f-hosted-production.md CLAUDE.md docs/decisions/README.md` plus each file whose `code-map` link you changed) prints `PROOF_OK`.
