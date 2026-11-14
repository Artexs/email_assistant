# Owner decisions log

Decisions that agents took for the owner with a default, so the work did not stop. The owner reads this file at any time and marks each entry.

- **Writer:** only the coordinator writes this file. Planners and workers record decisions in their ticket folder and final message; the coordinator copies the important ones here when it lands their branch. One writer keeps parallel jobs free of merge conflicts.
- **What goes in:** important decisions only. Kinds: `user-visible`, `security`, `privacy`, `money` (also LLM quota), `irreversible`, `production` (VPS, deploys, production config), `scope` (ticket drops, folds, cuts), `rule-exception` (an owner rule not followed). Small technical choices stay in `plan.md` and `questions.md`.
- **What does not go in:** decisions the owner made (they are PD rows in `docs/product/stage-2/decisions.md` and ADRs in `docs/decisions/`). A step that needs an API key, a secret, real money, deletion of real data or a publication outside: those still stop and ask the owner.
- **Status** (last word of the heading): `new` = not read yet; `ok` = the owner accepts it; `changed` = the owner wants a change (the owner writes it under the entry; the coordinator turns it into a ticket line and adds `→ <ticket or commit>`).
- **Check for new entries:** `grep -c ' · new$' docs/owner-decisions.md` (count) and `grep ' · new$' docs/owner-decisions.md` (headings).
- **Order:** newest first. Format of one entry:

```
### YYYY-MM-DD · <what it is about, plain words> (FNNN) · <kind> · new
- Choice: the default taken, one sentence.
- Why: one sentence.
- Undo: how to reverse it, or "cannot be undone".
- Source: the file and item, for example `spec/features/active/FNNN-slug/questions.md` Q2.
```

### 2026-11-14 · Feedback source "review" added; its down migration deletes review rows (F097) · irreversible · new
- Choice: migration `20261114110001_feedback_source_review.sql` adds the source `review` to the feedback CHECK. Rolling it back first deletes all `review` rows, because the old CHECK would reject them.
- Why: the review sample (the owner's audit of 50 cases) must not mix with taps from the digest. Rows only exist after the review flow runs.
- Undo: do not roll back after review rows hold real data; keep the rows by exporting them first.
- Source: F097 stage 03; Opus review accepted it. F100 stage 04 changes the same CHECK and needs the same care.

### 2026-11-14 · Telegram link needs a consent tick; Polish consent text is an agent draft (F098) · privacy · new
- Choice: the panel asks for a tick before it makes a Telegram link; the server refuses a link request without the current consent version and writes one `web.telegram_consent` audit row. The consent text says Telegram is a service outside the EU and data can be processed outside the EEA.
- Why: the Telegram bot gets draft text and quoted mail parts, so the user must agree first (privacy principle).
- Undo: change the texts in `apps/web/src/i18n/en.ts` and `pl.ts`; raise `TELEGRAM_CONSENT_VERSION` to ask again.
- Source: `spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/stages/stage-05-telegram-consent.md`; Opus review notes a to g. A lawyer's check of the text is a Stage 3 question.

## Entries

### 2026-11-14 · Two-factor sign-in (F105): no feature flag, a new QR dependency, operators need TOTP · security · new
- Choice: the plan takes these defaults: no feature flag for two-factor sign-in (a departure from PD-045); the web dependency `uqr` 0.1.3 (MIT, no dependencies) draws the QR code; operators need TOTP for the console, so an operator without TOTP is sent to the settings page; the break-glass owner is set only by the operator through a CLI and cannot turn TOTP off; disabling TOTP needs a live session and the password; enrolling TOTP ends the user's other sessions; no mail is sent for two-factor changes (the security log shows them).
- Why: sell-ready bar for an operator console and a PD-045 flag would only add a second switch that can lock people out.
- Undo: change the decisions in `spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass/plan.md` (D-lines) before the stages build; after the build, the operator reset `web:two-factor-reset` repairs a locked user.
- Source: `spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass/questions.md` Q1-Q8 and plan.md D27, D28.

### 2026-11-14 · F097 and F100 build while F095 is still open (F097, F100) · rule-exception · new
- Choice: the coordinator moved F097 and F100 to active and started their stages, although their ticket § Sequenced says "Build after: F095 in done/", and F095 still has stages 09 and 10 open.
- Why: F095 stages 01-08 (the capability pages and the docs boundary) had landed. Stages 09-10 are a dated wait and your phone session, and add no code that F097 or F100 use. The rule "owner steps are not a stop" and the idle seats made waiting a waste.
- Undo: stop the F097 and F100 jobs; the stages already landed stay valid (they only add code). The coordinator would then hold new stages until F095 is in done/.
- Source: `spec/features/active/F097-e2a-offline-lab/ticket.md` and `spec/features/active/F100-e3a-measure/ticket.md` § Sequenced; `spec/build.md` NEXT.

### 2026-11-14 · F100 stages 01-02 start although the plan-drift check says drift (F100) · rule-exception · new
- Choice: the coordinator started F100 stages 01 and 02 (capture parser, port and adapters) with a drift exit 1 (23 named paths changed since the refresh base), without a second refresh job.
- Why: the refresh landed minutes earlier and other tickets keep landing, so a new refresh goes stale at once; the changed paths belong to later stages (callbacks, digest, web, config). The workers must check every named path against HEAD.
- Undo: stop the two jobs; run `Refresh F100` again before the later stages (they wait for F097 stages 03-04 and F098 stages 08-11 anyway).
- Source: `scripts/plan-drift.sh spec/features/planned/F100-e3a-measure a6690e4`; owner rule plan-refresh in `spec/build.md`.

### 2026-11-14 · Telegram and panel texts of F100 follow the F098 registry state (F100) · user-visible · new
- Choice: a new F100 text goes into the F098 section file of its kind with en and pl only if that file exists when the stage starts; otherwise it stays English inline. Panel texts always get en and pl keys.
- Why: F098 moves the Telegram texts into a registry stage by stage; F100 must not block on it or undo it.
- Undo: change D31 in the F100 plan.
- Source: `spec/features/planned/F100-e3a-measure/questions.md` Q15.

### 2026-11-14 · Row-level security joined the foundation group, built as a per-connection tenant scope (F092) · security · ok
- Choice: the coordinator planned and built RLS on the review's default "yes". The web sets `app.org_id` on each connection acquire from an async tenant scope, not in one request transaction. A caller that runs raw SQL as `app` can still clear the setting, so the docs say "a safety net against a missed org_id filter".
- Why: existing code opens transactions inside requests (Kysely refuses nesting), so one request transaction would break it; the scope needs no route or repository change.
- Undo: roll back migration `20261114100002_rls_tenant_policies.sql` (`db:rollback`); the code still runs because jobs and unset scope are admitted by the policy. Not deployed to the VPS yet.
- Source: `spec/features/done/2026-11/F092-rls-safety-net/questions.md` Q1 and D7, D23.

### 2026-11-14 · Plans for Logs (F103) and Astro 7 (F101) written before E1 closed (F095) · rule-exception · ok
- Choice: the coordinator planned F101 and F103 while E1 was still building, although the owner rule says "plan a ticket only after the tickets it needs have landed".
- Why: the capability pages these plans read were already merged (E1 stages 02–07).
- Undo: none needed; F097, F100 and F101 get a plan refresh before their first stage (`.agents/limen/planner.md` § Refresh job).
- Source: `spec/build.md` NEXT order rule; `notes/2026-11-14-coordinator-audit.md` § 1.

### 2026-11-14 · Reviews and planners run on Opus 5.5, not Sonnet 5.5 · money · ok
- Choice: stage reviews and planner jobs ran on Opus 5.5; the board names Sonnet 5.5 for the reviewer.
- Why: owner decision 2026-11-13 moved plan reviews to Opus; the coordinator applied it to stage reviews too.
- Undo: write one reviewer model on the board (`spec/build.md` § TRACK).
- Source: `notes/2026-11-14-coordinator-audit.md` § 6; `notes/2026-11-14-overnight-summary.md` (quota hit twice).

### 2026-11-14 · Two VPS updates overnight · production · ok
- Choice: the coordinator updated the home VPS from `cab134f` to `d117cd6` (S6b login, Bun 1.4.4, foundation group, 3 migrations), then to `2edbfef` (log rotation).
- Why: VPS and deploy steps are pre-approved (owner decision 2026-11-13); each update took a backup first, named the rollback image and ran the checks.
- Undo: rollback images `ea-server:pre-f094`, `ea-server:pre-f096`; backups `ea-20261114T004546Z.dump.age`, `ea-20261114T011553Z.dump.age`.
- Source: `notes/2026-11-14-f094-vps-deploy.md`.
- Owner asked what the 3 migrations were; explained (auth_public F082, outbox_view F088, org_features F087).

### 2026-11-14 · Row-level security is built (F092) · security · ok
- Choice: RLS joins the foundation group and is built now (review default "yes"); the board said it waited for the owner's yes.
- Why: a missed `org_id` filter returns 0 rows instead of another organization's data.
- Undo: roll back the F092 migration (stage 01) before later tables depend on the policies.
- Source: `spec/features/active/F092-rls-safety-net/plan.md` input line; `06-architecture-review.md` §8.

### 2026-11-14 · Deleting a mailbox checks the tenant scope (F092) · security · ok
- Choice: `delete_mailbox` gets the tenant scope check.
- Why: it closes one more path that could touch another organization's rows.
- Undo: a small code change.
- Source: `spec/features/active/F092-rls-safety-net/questions.md` Q2.

### 2026-11-14 · Panel to Astro 7 gets its own VPS deploy (F101) · production · ok
- Choice: stage 04 deploys the Astro 7 panel to the VPS right after the docs stage.
- Why: a framework upgrade is easier to roll back alone.
- Undo: the rollback image of that deploy.
- Source: `spec/features/active/F101-panel-to-astro-7/questions.md` Q2.

### 2026-11-14 · Send limits are always on, with no feature flag (F099) · user-visible · ok
- Choice: the send limits (PD-044) hold for every organization; the three env keys `SEND_LIMIT_*` tune them.
- Why: a flag that is off would hold sends with no visible reason.
- Undo: change the env keys; a flag needs a code change.
- Source: `spec/features/active/F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log/questions.md` Q1.
- Owner 2026-11-14: a safety cap, not a usage limit; per-tier limits are a Stage 3 question in docs/product/stage-3/README.md §1.

### 2026-11-14 · The recipient send limit counts per mailbox, not per organization (F099) · security · ok
- Choice: "5 per recipient per rolling 24 h" counts per mailbox; an organization with two mailboxes can send 10 a day to one address.
- Why: per organization needs a lock over all mailboxes.
- Undo: a later ticket with that lock.
- Source: same file, Q2.
- Owner 2026-11-14: a safety cap, not a usage limit; per-tier limits are a Stage 3 question in docs/product/stage-3/README.md §1.

### 2026-11-14 · You are the operator and the security log is on for the pilot (F099) · production · ok
- Choice: stage 15 sets `OPERATOR_USER_IDS` to your user id on the VPS and turns `security_log` on for the pilot organization.
- Why: PD-045 "on for the pilot first".
- Undo: `org:flag --off`; remove the id from `.env`.
- Source: same file, Q4.

### 2026-11-14 · Polish words of the panel and Telegram (F098) · user-visible · ok
- Choice: informal "ty", imperative buttons; delegation = "zlecenie", delegate = "wykonawca", digest = "podsumowanie", notice = "komunikat", shadow mode = "tryb podglądu", assist mode = "tryb asystenta", draft = "szkic".
- Why: "delegacja" means a business trip in Polish.
- Undo: edit the dictionary.
- Source: `spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/questions.md` Q1.

### 2026-11-14 · No feature flag for the language (F098) · user-visible · ok
- Choice: the Account language choice is the only switch; the language has no flag.
- Why: ADR 0027 says flags are not product settings.
- Undo: add a `polish_ui` flag (extra reads for public pages and Telegram).
- Source: same file, Q3.

### 2026-11-14 · Telegram chats linked before the consent step keep their link (F098) · privacy · ok
- Choice: only new link requests need the consent tick; existing linked users are not asked.
- Why: a consent check on the bot side for old chats is extra work.
- Undo: ask every linked user once (bot-side check).
- Source: same file, Q4.

### 2026-11-14 · Telegram consent text (F098) · privacy · ok
- Choice: the agent's draft text: it names what Telegram receives (sender, subject, AI reason or summary, draft texts, delegate names, mailbox addresses), servers outside the EU, no end-to-end encryption, kept until deleted in the chat.
- Why: draft from S6 P19; exact pl and en text in stage 05 of F098.
- Undo: change the text and bump its version.
- Source: same file, Q6.

### 2026-11-14 · Verdicts for the old planned tickets (F095) · scope · ok
- Choice: keep F029/F032/F064 (one sync ticket), F062, F068, F074, F085; fold F037 and F047 into E1, F056 into the S6b login ticket, F060 into E4-B; park F023, F055, F063, F072, F076.
- Why: the triage of 2026-11-13 (`spec/features/planned/triage-2026-11-13.md`).
- Undo: move a ticket back to the NEXT list.
- Source: `spec/features/active/F095-e1-close-the-mvp/questions.md` Q8; `next.md`.

### 2026-11-14 · Behaviour text moved out of the architecture doc (F095) · scope · ok
- Choice: `docs/architecture.md` §4.1 rules 6–8, §4.4–§4.6 and most of §8 moved into `docs/capabilities/`; link lines stay.
- Why: architecture review §3.14; one page per capability is the planning baseline.
- Undo: `git revert` of E1 stages 03–07.
- Source: same file, Q1.

### 2026-11-14 · Your vision text changed (F095) · scope · ok
- Choice: E1 stage 01 put the PD-001 goal ("sell-ready, not sold") at the top of "Current direction" in `spec/vision.md` and changed five lines that contradicted it.
- Why: PD-001; the file is yours, so this needs your eye.
- Undo: edit or revert any line (commit `92032bb`).
- Source: same file, Q2.

### 2026-11-14 · More than 3 wrong moves in the S3 week change no setting (F095) · user-visible · ok
- Choice: if the S3 assist week shows more than 3 wrong moves, E1 records it and changes no setting; E3a and E3b are the follow-up.
- Why: E1 changes no behaviour.
- Undo: turn a category to `auto off` at any time.
- Source: same file, Q3.

### 2026-11-14 · Keep `SEND_SCOPE=all` and the test delegate after the S4 week (F095) · production · ok
- Choice: the VPS settings stay as they are.
- Why: E1 changes no production setting.
- Undo: change `.env` on the VPS.
- Source: same file, Q5.

### 2026-11-14 · E1 closes without the five executive conversations (F095) · scope · ok
- Choice: PD-007 is not a stage; E1 closes without it.
- Why: your call; an agent can write the result as a note if you hold them.
- Undo: hold the conversations at any time.
- Source: same file, Q6.

### 2026-11-13 · The F094 job branch was pushed to GitHub for CI · production · ok
- Choice: the coordinator pushed the Bun 1.4.4 job branch to `task/f094-bun-pin` so CI ran before the land.
- Why: Limen job branches get no CI; it kept `master` green.
- Undo: delete the remote branch (if it still exists).
- Source: `spec/features/active/F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x/questions.md` Q1.

### 2026-11-13 · The server refuses to start when an LLM role has no key (F090) · production · ok
- Choice: a role whose provider key is missing stops the server at start.
- Why: a wrong setting shows at once, not at the first judge call weeks later.
- Undo: a small config change.
- Source: `spec/features/done/2026-11/F090-llm-roles/questions.md` Q2.
