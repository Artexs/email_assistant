# F095 stage 03 — Pages `sync.md` and `triage.md`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4–D7, D19. Read "Rules for every stage" first.

Two pages, and the behaviour text of sync and triage moves out of `docs/architecture.md`. Three steps. Docs only.

**How to write a page (stages 03–07 use the same method):**

1. `git rev-parse --short HEAD` → the sha of the "Checked against" line; `date -u +%F` → the date.
2. Read the seams listed for the page (the module `index.ts` first, then the files it exports from), `apps/server/src/main.ts` (job names and schedules), the root `package.json` scripts, the routes files, the tests named, and the source rows of `docs/product/stage-2/02-inventory-and-roadmap.md` §2.
3. Write the seven sections of the template (`docs/capabilities/README.md`). Each claim must hold in the code you read (D7). A `02` §2 claim that the code does not hold: leave it out and list it in the final message.
4. Move the named `architecture.md` text into "Rules" or "Data" with its wording (D4); change only its cross-references (`§4.5` → `[drafts-and-send.md](drafts-and-send.md)`, or `docs/architecture.md` §N for what stays there).
5. In `architecture.md`, replace each moved block with one link line of this exact form: `Moved to [\`docs/capabilities/<page>.md\`](capabilities/<page>.md) § <section> (F095).` Keep headings (D5).
6. Change the inbound references to each moved block in the files of D6 (`grep -rn "architecture.md\`\? \?§<n>" docs deploy README.md CLAUDE.md .agents`); leave the others (D6).
7. Add the page row to the `## Pages` table of `docs/capabilities/README.md`: `| [<page>.md](<page>.md) | <Capability> | <main modules> |`.
8. `bun test apps/server/src/capability-map.test.ts` → 0 fail.

## Step 1 — `docs/capabilities/sync.md` ("Sync")

- **Goal:** an agent knows how mail gets into the system, from connect to a stored `emails` row, and every way it fails.
- **Seams:** `apps/server/src/modules/mail/` (`index.ts`, `sync.ts`, `sync-rules.ts`, `jobs.ts`, `connect.ts`, `connect-request.ts`, `check.ts`, `folders.ts`, `host-guard.ts`, `host-check.ts`, `status.ts`, `remove.ts`, `routes.ts`, `uid-next.ts`, `locate.ts`, `imap/`), `packages/core/src/mail/`, scripts `mailbox-connect.ts`, `mailbox-check.ts`, `mailbox-password.ts`, `mailbox-rescan.ts`, `mailbox-backfill.ts`, `mailbox-seed.ts`, `mailbox-audit.ts`; `docs/architecture.md` §6.1 (stays; link it for the IMAP rules); ADR 0009, 0010, 0014.
- **Must cover:** connect (web route and `bun run mailbox:connect`), the host guard and host check, the capability check, the folder keys and `mailbox_folders` (ADR 0014; INBOX, sort folders, spam folder; never `AI/*`, Sent, Drafts, Trash), the `mail.sync` job and its schedule, the UID cursor and dedup key (link §6.1 for the exact rules), returned mail (`emails.returned_at`), mailbox statuses (`active`, `paused`, `auth_error`) and the way out (`bun run mailbox:password`), remove, backfill (`emails.backfilled_at`), rescan, the seed and audit tools, the mailbox limit (one line, link `tenancy-and-plans.md`).
- **Moves from `architecture.md`:** §8 bullet "Mailbox errors" → "Rules".
- **Limits (at least):** polling every 5 min, no IMAP IDLE (E8 Should; E3a F100 moves the poll to 2 min); no Sent folder read (E5a F104); password only, no OAuth (E9a F117); the open sync gaps of the tickets in `planned/` (F029, F032, F064, F062, F085, F060) by folder name, one clause each.
- **Tests:** `apps/server/test/integration/mail-sync.test.ts`, `imap-sync-greenmail.test.ts`, `imap-contract.test.ts`, `mail-connect.test.ts`, `mail-host-guard.test.ts`, and the unit tests in `apps/server/src/modules/mail/` that exist.
- **Done when:** the page exists; method items 1–8 hold.

## Step 2 — `docs/capabilities/triage.md` ("Triage")

- **Goal:** an agent knows how a stored mail becomes a category, a summary and a plan, and how feedback and labels work.
- **Seams:** `apps/server/src/modules/triage/` (`index.ts`, the service, jobs, pause, classifier, prompts, eval files), `apps/server/src/modules/config/rules.ts` (hard rules), `packages/core` planners and policy (find them from `packages/core/src/index.ts`), `platform/llm/` (roles, `generate`), scripts `triage-label.ts`, `triage-cost.ts`, `eval.ts`, `llm-check.ts`; `docs/architecture.md` §4.1 rules 1–5, §4.2, §4.3 (stay; link them).
- **Must cover:** hard rules before the LLM, the classifier call (LLM role, prompt registry, Zod schema, thread context), categories and thresholds (link §4.2), the policy table (link §4.3), `TRIAGE_LLM_SCOPE`, the triage worker job and schedule, the LLM pause, the daily cap, `too_old`, feedback sources and rows, the eval runner (`bun run eval`) and labels (`bun run triage:label`), `bun run triage:cost`, the success metric (not built yet).
- **Moves from `architecture.md`:**
  - §4.1 rule 7: the paragraph "The triage worker (…) applies this rule to the email as follows:" with its six bullets (Soft error, Config error, Safety block, Hard error, Error outside the LLM call, Shutdown) → "Rules". Rule 7 keeps its first paragraph ("Retries live on the row that failed." … "Rule 6 wins for `send`.") and gets one link line for the triage part. The committer paragraph stays for stage 04.
  - §4.1 rule 8 (Cost limits): the rule keeps its bold headline sentence; the rest moves → "Rules".
  - §4.4: the bullets "Feedback sources", "Buttons under a digest line", "Feedback rows", "Eval on real mail", "Success metric" → "Rules". The bullets "Moved back by the user", "Undo" (stage 04) and "Digest lines for delegations" (stage 05) stay for now.
  - §4.6: the `emails.status:` block → "Data" (as a fenced block).
- **Limits (at least):** no phishing flag, no attachments in the prompt, no urgency context (E3b F109); no weekly handled-share line (E3a F100); the gate on real labels (ADR 0028 proposed, E3 numbers); the junk LLM cap (F063, by folder name).
- **Decisions:** ADR 0003, 0007, 0012, 0013, 0015, 0028 (proposed); PD-003, PD-056.
- **Tests:** `apps/server/test/integration/triage-job.test.ts`, `triage-feedback.test.ts`, `triage-gate.test.ts`, `triage-repo.test.ts`, `triage-requeue.test.ts`, `apps/server/src/modules/triage/classifier.test.ts`, and the core planner and policy tests you find.
- **Done when:** the page exists; method items 1–8 hold.

## Step 3 — Check `architecture.md`

- **Check:** `grep -c "Moved to \[\`docs/capabilities/" docs/architecture.md` → 5 or more (rule 7 triage part, rule 8, §4.4 feedback part, §4.6 emails, §8 mailbox errors; count your own link lines). `grep -n "^### 4\.[1-6]\|^## 8\." docs/architecture.md` → the headings are still there. The flow diagram of §4.1 and rules 1–5 are unchanged (`git diff` shows no change there).
- **Done when:** the checks hold and `bun test apps/server/src/capability-map.test.ts` → 0 fail.

## Review focus

Pick ten claims of the two pages and check each against the code at the "Checked against" sha. Check that every moved block is in a page with its wording (diff the removed lines against the page) and that no rule of the old text is lost.

## Done when

- Steps 1–3 hold.
- The Proof command of `plan.md` (`/tmp/f095-s03`, files: `docs/capabilities/sync.md docs/capabilities/triage.md docs/capabilities/README.md docs/architecture.md` plus each other `.md` file whose references you changed) prints `PROOF_OK`.
