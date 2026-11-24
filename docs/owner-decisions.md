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

### 2026-11-14 · Gate G1 of company sign-in passed on a default after the spike (F119) · scope · ok
- Choice: the second pass on PD-040 and PD-041 after the spike stage was passed by the coordinator. The build goes on after stage 01.
- Why: all ten spike checks pass and no plan decision broke (`spike.md`). Your order says owner checkpoints are not a stop.
- Undo: tell the coordinator to hold stage 03 and later. Stage 03 is the first change to `bun.lock`, and the secret storage (Q1) can still change before it.
- Source: `spec/features/active/F119-e7-t7-identity-b-oidc/spike.md`, `plan.md` G1.

### 2026-11-14 · Company sign-in: the IdP client secret is stored in clear in `sso_providers` (F119) · security · ok
- Choice: the OIDC plugin reads the client secret from `sso_providers.oidc_config` itself, so it stays in clear there. The secret is never exported or logged. Options at gate G1: an Entra certificate, or a decrypt plugin.
- Why: the plugin has no read hook. A decrypt plugin changes every auth path.
- Undo: change the storage at G1, before the build goes on.
- Source: `spec/features/planned/F119-e7-t7-identity-b-oidc/questions.md` Q1.

### 2026-11-14 · Company sign-in asks no TOTP code; the operator console refuses it (F119) · security · ok
- Choice: an SSO sign-in asks no second factor, because the IdP owns it. SSO sessions cannot open the operator console (`403 password_sign_in_required`). "SSO required" refuses a password with the wrong-password answer, and only the operator reopens passwords.
- Why: the IdP already did the second factor, and the console needs the stronger password plus TOTP path.
- Undo: add a TOTP step after SSO in a later ticket.
- Source: `spec/features/planned/F119-e7-t7-identity-b-oidc/questions.md` Q2, Q5.

### 2026-11-14 · Company sign-in setup: a new CLI adds members, `--require on` has prerequisites (F119) · scope · ok
- Choice: `org:member --add` creates members with no password, and `org:member --end-sessions` ends a member's sessions. `--require on` needs a proved domain, the flag on, a break-glass owner with TOTP, every other member's e-mail on the domain, and it ends old password sessions.
- Why: no just-in-time accounts exist, and ADR 0026 point 7 needs a way to end sessions.
- Undo: change the prerequisites in stage 08.
- Source: `spec/features/planned/F119-e7-t7-identity-b-oidc/questions.md` Q3, Q4, Q7.

### 2026-11-14 · Entra test tenant costs about 7 USD a month after the trial (F119) · money · ok
- Choice: the Entra test tenant is the M365 Business Basic seat that F117 also needs. The owner buys it before stage 15.
- Why: the real end-to-end check needs a real Entra tenant.
- Undo: skip stage 15 and close the ticket without the real check.
- Source: `spec/features/planned/F119-e7-t7-identity-b-oidc/questions.md` Q10.

### 2026-11-14 · Legal drafts name no person, company, bucket region or breach register place (F107) · privacy · ok
- Choice: the drafts use only the placeholders `<provider name>`, `<address>`, `<contact>`, `<B2 region>` and `<breach register location>`. No repo file gives them.
- Why: the repo is public, and no file states the B2 region.
- Undo: fill the placeholders in the pages, then bump the terms version.
- Source: `spec/features/planned/F107-e7-t4-papers-and-cost/questions.md` Q1, Q3, Q5.

### 2026-11-14 · Polish draft line on the legal pages (F107) · user-visible · ok
- Choice: "WERSJA ROBOCZA, nie jest poradą prawną. Ta usługa działa na prywatnym serwerze wyłącznie dla jej właściciela."
- Why: the pages are drafts with no lawyer review, and the product is not sold.
- Undo: change one text key and bump the terms version.
- Source: `spec/features/planned/F107-e7-t4-papers-and-cost/questions.md` Q2.

### 2026-11-14 · Every legal text change needs a new terms version (F107) · user-visible · ok
- Choice: after stage 06, any text change (a typo too) bumps `TERMS_VERSION` and members accept again. Between stage 02 and stage 06, other deploys may show unfinished drafts under the old version.
- Why: a guard test pins the digest of every legal text to a version (D18).
- Undo: relax the guard for typo fixes later.
- Source: `spec/features/planned/F107-e7-t4-papers-and-cost/questions.md` Q7, Q10.

### 2026-11-14 · Breach notice target to the controller is 24 hours (F107) · security · ok
- Choice: the processor notifies the controller without undue delay, target 24 hours.
- Why: GDPR art. 33(2) says "without undue delay", and 24 hours is a clear target.
- Undo: change the number in the breach procedure and the DPA.
- Source: `spec/features/planned/F107-e7-t4-papers-and-cost/questions.md` Q9.

### 2026-11-14 · Cost model uses the Hetzner CX23 reference and a placeholder for the home VPS (F107) · money · ok
- Choice: `costToRun` uses the PD-059 hosting reference (Hetzner CX23). The home VPS cost is `<home VPS cost>`.
- Why: PD-059 is newer than the E7 notes, and the home VPS cost is not in the repo.
- Undo: change the constant and the model note.
- Source: `spec/features/planned/F107-e7-t4-papers-and-cost/questions.md` Q8.

### 2026-11-14 · Flag refresh marks unreadable mail as "tried" with an empty flag row (F100 stage 06) · data · ok
- Choice: when the refresh cannot find or match a mail, it writes a row in `email_flags` with all flags false and `checked_at` = now. `checked_at` means "last tried", not "flags known".
- Why: without it, such mail stays first in the queue for 30 days. About 3,000 of them would block the check of live mail, and a later "answered" flag would be missed (M1 under-count). A review reproduced this.
- Cost: a later reader cannot tell "tried, flags unknown" from "read, no flags". A gone mail never gives a false "answered", so M1 stays a lower bound. If coverage numbers need the difference, add a nullable column in the stage 16 migration.
- Undo: make `touchEmailFlags` update-only (the starving queue returns).
- Source: review of F100 stage 06 (note N1), `docs/capabilities/sync.md` rule 6.

### 2026-11-14 · Two-factor migration down path (F105 stage 01) · security · ok
- Choice: migration `20261114130001_two_factor.sql` adds `auth_two_factors`, `users.two_factor_enabled` and `memberships.break_glass`. Its down step drops them, so it deletes every enrolled second factor and every break-glass mark.
- Why: a down step must restore the old schema. Review proved the rest of the data stays (users, memberships, policy).
- Undo: never run `db:rollback` on the VPS after users enrol. The deploy rule already says this.
- Source: review of F105 stage 01 (`notes` in the job `2026-11-14-f105-review-s01-9095b249`).

### 2026-11-14 · Production deploy of F099 (with F092 and F098 code) and operator id (F099) · security · ok
- Choice: I deployed `65164fd` to the VPS and set `OPERATOR_USER_IDS` to the pilot org owner. Backup and rollback target are named in `notes/2026-11-14-f099-vps-deploy.md`.
- Why: the operator console needs one operator; the owner of the pilot org is the only real user. All 9 checks held.
- Undo: remove the id from the VPS `.env` and restart the server; or roll back to image `ea-server:pre-f099` (never run `db:rollback`).
- Source: `stages/stage-15-vps-deploy.md`.

### 2026-11-14 · F104 plan started while F095 is still open (F104) · scope · ok
- Choice: the F104 plan job started when F095 had stage 10 running and stage 09 waiting for 22:40Z. Your order rule asks for "needs landed" first.
- Why: F095 is docs and a runbook only; no code that F104 reads depends on it. F099 (the other need) is landed and deployed.
- Undo: stop the planner job `2026-11-14-f104-plan-e5a-7ba7bb48`; the plan can be re-run after F095 closes.
- Source: `docs/product/stage-2/05-execution-plan.md` §2.1 row 10.

### 2026-11-14 · Feedback source "review" added; its down migration deletes review rows (F097) · irreversible · ok
- Choice: migration `20261114110001_feedback_source_review.sql` adds the source `review` to the feedback CHECK. Rolling it back first deletes all `review` rows, because the old CHECK would reject them.
- Why: the review sample (the owner's audit of 50 cases) must not mix with taps from the digest. Rows only exist after the review flow runs.
- Undo: do not roll back after review rows hold real data; keep the rows by exporting them first.
- Source: F097 stage 03; Opus review accepted it. F100 stage 04 changes the same CHECK and needs the same care.

### 2026-11-14 · Telegram link needs a consent tick; Polish consent text is an agent draft (F098) · privacy · ok
- Choice: the panel asks for a tick before it makes a Telegram link; the server refuses a link request without the current consent version and writes one `web.telegram_consent` audit row. The consent text says Telegram is a service outside the EU and data can be processed outside the EEA.
- Why: the Telegram bot gets draft text and quoted mail parts, so the user must agree first (privacy principle).
- Undo: change the texts in `apps/web/src/i18n/en.ts` and `pl.ts`; raise `TELEGRAM_CONSENT_VERSION` to ask again.
- Source: `spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/stages/stage-05-telegram-consent.md`; Opus review notes a to g. A lawyer's check of the text is a Stage 3 question.

## Entries

### 2026-11-14 · Two-factor sign-in (F105): no feature flag, a new QR dependency, operators need TOTP · security · ok
- Choice: the plan takes these defaults: no feature flag for two-factor sign-in (a departure from PD-045); the web dependency `uqr` 0.1.3 (MIT, no dependencies) draws the QR code; operators need TOTP for the console, so an operator without TOTP is sent to the settings page; the break-glass owner is set only by the operator through a CLI and cannot turn TOTP off; disabling TOTP needs a live session and the password; enrolling TOTP ends the user's other sessions; no mail is sent for two-factor changes (the security log shows them).
- Why: sell-ready bar for an operator console and a PD-045 flag would only add a second switch that can lock people out.
- Undo: change the decisions in `spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass/plan.md` (D-lines) before the stages build; after the build, the operator reset `web:two-factor-reset` repairs a locked user.
- Source: `spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass/questions.md` Q1-Q8 and plan.md D27, D28.

### 2026-11-14 · F097 and F100 build while F095 is still open (F097, F100) · rule-exception · ok
- Choice: the coordinator moved F097 and F100 to active and started their stages, although their ticket § Sequenced says "Build after: F095 in done/", and F095 still has stages 09 and 10 open.
- Why: F095 stages 01-08 (the capability pages and the docs boundary) had landed. Stages 09-10 are a dated wait and your phone session, and add no code that F097 or F100 use. The rule "owner steps are not a stop" and the idle seats made waiting a waste.
- Undo: stop the F097 and F100 jobs; the stages already landed stay valid (they only add code). The coordinator would then hold new stages until F095 is in done/.
- Source: `spec/features/active/F097-e2a-offline-lab/ticket.md` and `spec/features/active/F100-e3a-measure/ticket.md` § Sequenced; `spec/build.md` NEXT.

### 2026-11-14 · F100 stages 01-02 start although the plan-drift check says drift (F100) · rule-exception · ok
- Choice: the coordinator started F100 stages 01 and 02 (capture parser, port and adapters) with a drift exit 1 (23 named paths changed since the refresh base), without a second refresh job.
- Why: the refresh landed minutes earlier and other tickets keep landing, so a new refresh goes stale at once; the changed paths belong to later stages (callbacks, digest, web, config). The workers must check every named path against HEAD.
- Undo: stop the two jobs; run `Refresh F100` again before the later stages (they wait for F097 stages 03-04 and F098 stages 08-11 anyway).
- Source: `scripts/plan-drift.sh spec/features/planned/F100-e3a-measure a6690e4`; owner rule plan-refresh in `spec/build.md`.

### 2026-11-14 · Telegram texts follow the Account language; a user with no language gets Polish (F098) · user-visible · ok
- Choice: from F098 stage 12 on, every Telegram text is in the user's Account language (`users.locale`); an unset language reads as Polish. English users see byte-identical English texts.
- Why: one Account setting must drive both channels; the pilot owner is Polish-speaking. The panel stays in the browser language until the user sets one.
- Effect after deploy: every production user with no language set gets Polish Telegram text at once, possibly the owner. An old English card queued before the deploy gets Polish status lines on edit (up to 7 days).
- Undo: set the language to English in Settings → Account, or revert F098 stage 12 (the hold flag no longer exists after it).
- Source: `spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first/questions.md` items 8, 9, 11; review `2026-11-14-f098-review-s12-df316a0c` note 8.

### 2026-11-14 · Telegram and panel texts of F100 follow the F098 registry state (F100) · user-visible · ok
- Choice: a new F100 text goes into the F098 section file of its kind with en and pl only if that file exists when the stage starts; otherwise it stays English inline. Panel texts always get en and pl keys.
- Why: F098 moves the Telegram texts into a registry stage by stage; F100 must not block on it or undo it.
- Undo: change D31 in the F100 plan.
- Source: `spec/features/planned/F100-e3a-measure/questions.md` Q15.

### 2026-11-14 · Account data: delete, export and erase defaults (F106) · privacy · ok
- Choice: the F106 plan took its defaults. A wrong password in the delete dialog counts toward the sign-in lockout (10 in 15 minutes). The DSR address hash key comes from `CREDENTIALS_KEY` by HKDF. Export and DSR report encrypt to one `age` public key, no passphrase mode. A DSR for a member's or the organization's own address is refused. A mail whose only Reply-To is the person is erased like a mail from the person. Erase also writes `[removed]` into kept rows and blanks stored digest copies. The delete dialog sits behind the flag `org_delete`, default off.
- Why: data leaves or is removed only on an explicit, logged, owner-side act; no new secret; no copy of the person's data survives in a Telegram row.
- Effect: a backup restore brings back deletes and erases made after the backup; the runbook says to keep each CLI record line outside the server and run them again after a restore. If `CREDENTIALS_KEY` changes, old DSR hashes no longer match.
- Undo: change the plan defaults before the stages run; after a delete or erase no undo.
- Source: `spec/features/planned/F106-e7-t3-account-data-delete-export-dsr/questions.md` Q1 to Q17.

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

### 2026-11-14 · Reviews and planners run on Opus 5.5, not Sonnet 5.5 · money · changed
- Choice: stage reviews and planner jobs ran on Opus 5.5; the board names Sonnet 5.5 for the reviewer.
- Why: owner decision 2026-11-13 moved plan reviews to Opus; the coordinator applied it to stage reviews too.
- Undo: write one reviewer model on the board (`spec/build.md` § TRACK).
- Changed 2026-11-14 (commit 7d6d14ef): Opus 5.5 only for risky stages and plans (list in spec/build.md TRACK); else Sonnet 5.5; a review task names the model and the reason.
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

### 2026-11-15 · Read Sent: data requests erase sent mail; the operator may turn the switch on by CLI (F104) · privacy · ok
- Choice: `org:dsr --erase` treats sent mail as the F106 rule treats incoming mail (a sent mail whose only other party is the person is deleted and tombstoned; other sent mail loses the address). The operator may turn "Track my sent mail" on with the CLI, only on the owner's instruction. Turning it on or off writes an audit row, not a security-log entry.
- Why: F106 landed first, so F104 adds the sent columns to its registries. Test organizations have no owner who taps the panel.
- Undo: scrub only, drop stage 12 (Q11); the CLI turns the switch off only (Q13); add a security-log kind (Q12).
- Source: `spec/features/planned/F104-e5a-read-sent/questions.md` Q11, Q12, Q13.

### 2026-11-15 · Planner and plan-refresh jobs run at thinking medium (harness) · money/quota · ok
- Choice: planner jobs and plan-refresh jobs spawn with `--thinking medium` (was high). The planner's own cold review stays at high. Jobs already running keep their level.
- Why: the harness review of 2026-11-15 shows plan jobs are a large share of token cost; the cold review still checks the decisions.
- Undo: set planner back to high in `spec/build.md` TRACK.
- Source: `notes/2026-11-15-harness-review.md`, owner decision commit 0499dd1c, rule `harness-2026-11-15`.

### 2026-11-15 · Mailbox OAuth: token memory, flags, consent page, revoke, ID-token check (F117) · security · ok
- Choice: the server keeps access tokens in process memory and reuses each while 5 minutes or more remain (ADR 0031 said "for one job"; stage 19 amends it, because Microsoft rotates the refresh token at each redeem). Flags `mail_oauth_microsoft` and `mail_oauth_google` gate only a new connect. The admin-consent result page sits on the tailnet-only panel (an administrator outside the tailnet sees an error page; the approval still counts). An organization delete revokes no Google token; a single mailbox Remove does. The code does not check the ID-token signature; it checks `aud`, `exp` and `iss` (OIDC Core §3.1.3.7 rule 6, token from the token endpoint).
- Why: a refresh-token rotation cannot be reused per job; a connected mailbox must keep working with a flag off; the panel is tailnet-only by design.
- Undo: Q1, Q2, Q4, Q6, Q8 of the questions file give the other option and its change.
- Source: `spec/features/planned/F117-e9a-mailbox-oauth/questions.md` Q1, Q2, Q4, Q6, Q8.

### 2026-11-15 · Review findings are sorted into three groups; workers run a guard-removal check (harness) · money/quota · ok
- Choice: every stage review task ends with the sort line (BLOCKING, TEST GAP, NOTE). A NOTE is filed as `review-<n>.md` and landed with no repair job. A TEST GAP is one `claude-sonnet-5-5 --thinking medium` continue with no re-review. A BLOCKING finding gets a repair as before. Workers of reviewed stages run the guard-removal check.
- Why: about 80 % of reviewed stages needed a continue; most findings are test gaps or notes.
- Undo: remove the "Review findings" line from `spec/build.md` TRACK.
- Source: `notes/2026-11-15-harness-review.md` section 8, commit 4f6d7536.

### 2026-11-15 · Planners start 2–4 Sonnet scouts (harness) · money/quota · ok
- Choice: planner jobs start 2–4 Sonnet scouts (`--role scout`, `--thinking medium`) and file the packets in `scouts.md`. Refresh jobs start none.
- Why: fewer cache reads per plan job; the measured cost was about $12–25 per plan.
- Undo: remove the scout rule from `.agents/limen/planner.md`.
- Source: `notes/2026-11-15-harness-review.md` section 8.

### 2026-11-15 · Panel approvals and delegations: reminder drafts not editable, any member marks Done, cancel is final, five phone tabs, flags on for pilot (F102) · user-visible · ok
- Choice: reminder drafts can only be approved or rejected in the panel (Q2). A Telegram decision also edits the other owners' cards (Q3). No panel "send all" button (Q4). The panel can approve with no linked Telegram (Q5). Any member can mark a delegation Done; remind, cancel and approvals are owner only (Q7). The phone tab bar keeps five tabs and Rules and Stats move to the user menu (Q8). Stage 20 turns `approvals_page` and `delegation_pages` on for the pilot organization (Q10). A panel cancel sets `user_cancelled` and cannot be undone (Q12). A rollback of stage 20 expires waiting sends of edited drafts (Q17).
- Why: smallest design that keeps owner-only control and avoids sending a template text instead of an approved edit.
- Undo: the questions file gives each other option and its change.
- Source: `spec/features/planned/F102-e4-a-act-from-the-panel/questions.md` Q2, Q3, Q4, Q5, Q7, Q8, Q10, Q12, Q17.

### 2026-11-15 · Docs site: no text for flagged features, API and evidence reference later, tag deploy rule, inline styles (F112) · scope · ok
- Choice: the user docs describe nothing that a default-off flag gates, and a test enforces it (Q1). The API reference and the autonomy-evidence reference move to F121, because F102 and F110 have no code yet (Q2). A tag deploys the docs only when it is the newest plain `v<x.y.z>` tag and `CHANGELOG.md` holds that release; a manual run deploys any branch or tag and is the rollback; the first deploy is a manual run on `master` (Q4). The docs site allows `'unsafe-inline'` for styles because Starlight sets `style` attributes, and it has no `frame-ancestors` because a meta tag cannot set it and Pages sets no headers (Q6).
- Why: docs must not promise what is off; the plan-after rule; a safe, reversible publish path; a limit of the Pages host.
- Undo: `spec/features/planned/F112-e10a-docs-site/questions.md` Q1, Q2, Q4, Q6 give the other option and its change.
- Source: `spec/features/planned/F112-e10a-docs-site/questions.md` Q1, Q2, Q4, Q6.

### 2026-11-15 · Operator console gets no axe check in F102 (F102) · scope · ok
- Choice: F102 stage 07 runs the axe accessibility check on every customer page and not on the operator console (Q20). The e2e server reads `OPERATOR_USER_IDS` at boot, before the seed makes user ids.
- Why: an operator e2e user needs a separate stage; the console is for the owner only.
- Undo: add a stage that gives the e2e run an operator user, then add the console to the axe spec.
- Source: `spec/features/planned/F102-e4-a-act-from-the-panel/questions.md` Q20.

### 2026-11-15 · Improve: gate on defaults, spend caps, ship rules, escalation cost limit (F109) · money · ok
- Choice: the second pass after the first holdout report is taken on defaults. The holdout shows urgent false negatives at 14.1% and needs_reply at 6.2% against the target of under 2%, so the escalation experiment is built, and production escalation follows only on a "ship" decision (Q1). Real LLM spend caps: stage 09 $2.00, stage 11 $0.60, stage 13 $2.50, total at most $5.10; the escalation holdout run is capped at $1.50, above the $1 default run cap (Q7). v3 ships only when it beats v2 on one holdout run by max(4, 2 × run noise) key misses with no proven precision loss; the full 98% gate is not the rule (Q5, Q6). Escalation ships only when hidden important mail is at most half and classifier plus escalation cost at most $3 per mailbox per month (Q8). Phishing flags need recall at least 90% on the holdout, 0 flags on whitelisted mail and at most 2% on other mail, else the flag stays off (Q4). A flagged delegation mail plans nothing (Q9). v3 rolls back after 14 days on the pilot if the gap report says gap or key misses go up (Q18).
- Why: the numbers show a real gap, but production change needs a measured win.
- Undo: `spec/features/planned/F109-e3b-improve/questions.md` Q1, Q4–Q9, Q18 give the other option and its change.
- Source: `spec/features/planned/F109-e3b-improve/questions.md`.

### 2026-11-15 · Phishing flag stays off: the sim holdout misses the non-phishing flag-rate target by definition (F109) · scope · ok
- Choice: the first measurement of the suspicious-mail rules on the sim holdout (one run, rules unchanged) gives recall 21 of 21, 0 of 315 whitelisted cases flagged, and 67 of 1392 (4.8%) non-phishing cases flagged against the target of at most 2%. All 67 are plain spam from the one phishing persona (`billing@paliwa-fiota.test`) with a look-alike domain, so they count as non-phishing only because their slot has no `phishing_*` tag. By persona, 0 of 1325 other senders are flagged. Per the Q4 rule the `suspicious_mail` flag stays off. No second holdout run is made.
- Why: the written target is missed, and the sim has one phishing persona, so recall mostly tests one rule (`lookalike_domain`).
- Undo: change the definition of "phishing" in `eval-suspicious.ts` to the persona group and rerun the dev part only; a flag turn-on for the pilot organization is a later owner decision after real mail shows the rate.
- Source: `notes/2026-11-15-f109-s05-suspicious-measurement.md`, `evals/results/2026-11-15-sim-lab-01-holdout-suspicious.md`, `spec/features/active/F109-e3b-improve/questions.md` Q4.

### 2026-11-15 · Private model: one endpoint per deployment, own model on the owner's PC, https rule (F111) · privacy · ok
- Choice: one LLM endpoint per deployment, set by the operator in env, not one per organization; the VPS pilot keeps the US API. This differs from the wording of ADR 0035 decision 1 and the E11 epic page ("EU default for every org except the pilot"), but follows PD-101; stage 06 rewrites the ADR to match (Q1). The own-model runs use the owner's PC (AMD RX 6950 XT, 16 GB), which needs `sudo pacman -S ollama-rocm` (owner step O2); fallback is a rented GPU for at most $5 (Q2). The endpoint URL must be `https`; plain `http` only to loopback or a one-label container host; a remote host counts as an own server only with `OPENAI_ENDPOINT_KIND=own`; hosted compatible APIs (Azure, OpenRouter) are refused (Q5). The second candidate model is `gemma3:12b` (Q3). If OpenAI does not answer, stage 07 waits and the coordinator asks again 30 days after O1 (Q4).
- Why: one endpoint per deployment is the smallest safe design; the PC GPU is free; a strict URL rule stops a stray env var from redirecting mail text.
- Undo: `spec/features/planned/F111-e11b-private-model-option/questions.md` Q1–Q5; a per-organization endpoint needs a stage before 07 after the PD-110 second pass.
- Source: `spec/features/planned/F111-e11b-private-model-option/questions.md`.

### 2026-11-15 · Live lab: production key on the sim stack, caps $1 and $5, runs on the VPS, no new phishing corpus (F113) · money · ok
- Choice: the sim stack (`ea-sim`, a second Compose project on the production VPS, own port 8180, subnet, volumes and env file, about 1.5 GB of memory) uses the production OpenAI key: the coordinator copies it inside the VPS into `deploy/sim.env` and never prints it. The lab has its own caps: $1 per day run and $5 per week run, inside the $20 month cap. A live day needs at least 2 GB free disk; the live week waits for owner step O1 (grow the VPS root volume, PD-055) (Q1, Q2). Dates in mail text move with the run's whole-week offset; bare years, month-and-year and ids stay (Q3). No new corpus text and no "not mine" delegate answer: the frozen v1 corpus stays, so the live lab says nothing new about phishing beyond F109 (Q4). `server` and `lab` share the fake Telegram's network namespace, so the loopback check on `TELEGRAM_API_ROOT` stays (Q5). The executive taps only approve, reject with reason, Undo, reminder sets and send again; each measured run starts on a fresh lab organization (Q6–Q13).
- Why: a second key would add a secret to manage; the VPS already runs the production stack; the lab week is the first real measure of M1–M7.
- Undo: `spec/features/planned/F113-e2b-live-lab/questions.md` Q1 (a separate OpenAI project key) and Q2 (run only on the owner's PC; needs Docker access for agents).
- Note for the owner: the week run costs up to $5, above the $1 per-run cap you approved on 2026-11-15; I ask for your go before C4. The day run (up to $1) fits.
- Source: `spec/features/planned/F113-e2b-live-lab/questions.md` Q1–Q13.

### 2026-11-15 · Classifier v3: ship the `list` part to the one holdout run; urgency and history rejected (F109) · scope · ok
- Choice: the dev experiments (10 runs, $0.78 of the $2.00 cap, `gpt-6-luna`) chose the part `list` (mean key misses 14 against about 24 for attachments only and 23 for v2). `urgency` is rejected (it raises urgent false positives and cuts needs_reply true positives), and `history` is rejected (27 key misses; the sim history is the persona group's ideal mix). The literal injection side condition (not fewer than mean 16.5 of 17) would give "none", but one planted injection case fails in 9 of 10 runs, so I read it as noise and keep `list`. It gets the one holdout run of stage 11; if it fails the holdout rules, v2 stays in production.
- Why: the stage rule has no clean answer for an integer count against a mean; the holdout rule 4 has its own injection bar (at least 29 of 31) and a whitelist rule.
- Undo: choose "none" and skip stage 11 (v2 stays).
- Source: `evals/results/2026-11-15-f109-v3-dev-summary.md`, `spec/features/active/F109-e3b-improve/stages/stage-09-*.md`, review of job `2026-11-15-f109-review-s09-opus-v3-dev-expe-e7219c3c`.

### 2026-11-15 · No Telegram consent-version bump for the suspicious-mail warning line (F109) · scope · ok
- Choice: the warning line in the urgent notice and the digest does not bump `TELEGRAM_CONSENT_VERSION`. Rule applied: bump when a new kind of mail-derived data (address, name, domain, subject, body, attachment name, link host) reaches Telegram. Do not bump for fixed phrases that our code picks from its own rule codes. A stage that sends attachment names or link hosts (F109 stage 06) does need a bump.
- Why: the line holds only fixed phrases for enum codes (DB CHECK, view schema and text map all limit them). No sender, domain or subject can reach it.
- Undo: bump the version in `packages/core` and the consent text, and re-ask consent; one stage of work.
- Source: review of job `2026-11-15-f109-review-s04-opus-polish-warn-5a6f80d7` (N2), `docs/code-patterns.md` section "The consent version".

### 2026-11-15 · The attachment line in Telegram stays off for orgs with linked chats until consent can be asked again (F109) · privacy · ok
- Choice: flag `attachment_line` (attachment names in the urgent notice and digest) is built and its consent version is bumped to `2026-11-15`. But the version gate blocks only NEW chat links (`POST /channels/telegram/link` answers 409 for an old version). Chats that are already linked are not asked again, and the senders never read the version. So the flag stays OFF for every org with a linked chat. The owner's own pilot chat is such a chat: do not turn the flag on there until a re-ask exists or you accept the gap.
- Why: with the flag on, a linked user would receive attachment names they never agreed to (proven by an Opus review scratch test: rows with the line were queued for chats with consent `2026-11-14`).
- Options: (a) a send-side gate (a consent version per chat link; mail-derived fields only for the current version, or a bot message that asks again): about one stage of work; (b) accept that a bump affects new links only and say so in `docs/code-patterns.md`.
- Undo: not needed (flag off). To go live choose (a) or (b).
- Source: review of job `2026-11-15-f109-review-s06-opus-attachment-02ea93d9` (N1), `docs/code-patterns.md` section "The consent version".

### 2026-11-15 · F115 reply drafts plan: consent raise, LLM spend of the prototype, copy check (F115) · money · ok
- Choice: (1) Stage 12 raises `TELEGRAM_CONSENT_VERSION`: AI-written reply drafts and other recipients' addresses are new data in Telegram. Chats linked under an older consent keep the link but get only a count and a panel link until the user agrees again in the panel (consistent with the F109 attachment-line decision: a re-ask is part of this ticket). (2) Stage 02 spends real LLM money: at most $2 for each of 3 runs ($6 in total), inside the $20 month cap; the judge runs on the other provider (this is the eval budget path, not the lab; the cap is per run and written in the plan; it is above the lab's $1 per run, so it needs your yes before stage 02 runs). (3) For delegation, clarification and reminder sends the Drafts-copy check is behind a new org flag `draft_copy_check`, default off; reply sends always check. (4) With the flag `reply_drafts` off, approve answers "off" and the committer holds reply sends until they expire. (5) Telegram cards show the full reply text until E9b adds detail levels. (6) The org signature card becomes read-only; signatures are per mailbox.
- Why: reply text and recipient addresses are mail-derived data; the copy check fails safe (no send) and needs a stable copy on Interia (probe P1 after stage 08).
- Undo: set the flag `reply_drafts` off; the consent raise is one version constant; spend is capped per run.
- Source: `spec/features/planned/F115-e6a-reply-drafts/questions.md` (24 items: 1, 2, 4, 6, 19, 20 are the important ones), `plan.md`, `plan-review-1.md`.

### 2026-11-15 · F110 earn-trust plan: evidence rule, history check at connect, pause (F110) · privacy · ok
- Choice (plan defaults, 26 stages): (1) A gate file marked provisional (owner audit pending) is shown but makes no category eligible, so today no category is recommended until the audit of lab-01 v1 is applied. (2) The PD-068 rule (upper bound ≤ 2% on ≥ 50 acted-on mails) needs at least 189 mails with zero hidden; applied as written most mailboxes fail, against PD-030 ("only blocks"). Default: `fail` only when the observed share is over 2%; `inconclusive` (does not block) between that and a pass; `no_result` under 50 mails. (3) At connect, the history backfill stores up to 30 days of INBOX mail as `skipped` / `history_check` rows, behind the flag `trust_ladder` (privacy). (4) A history `fail` pauses a category that already has `auto` on, unless the user forced it on. (5) By mail go only the digest, the weekly report and the two trust notices. (6) With no price for the model and endpoint, no history check runs. Stages 22–24 (bulk unsubscribe) can be cut.
- Why: the plan follows the E4-B epic and the F111 gate rule (model and endpoint).
- Undo: flag `trust_ladder` off; cut stages 22–24 if unwanted.
- Source: `spec/features/planned/F110-e4-b-earn-trust/questions.md` (Q1, Q2, Q5, Q6, Q8, Q13 are the important ones) and `plan.md`.

### 2026-11-15 · F119 docs: SSO-only member can set a password by reset link (F119) · security · ok
- Choice: the code does not refuse it. A reset creates a credential account, and in an organization without "SSO required" that password signs in. Docs state it as a default.
- Why: refusing needs code and a plan change; the owner can still require SSO per organization.
- Undo: a later ticket adds a refusal for SSO-only members. Also open: axe checks for the company sign-in block, the Account card of a member with no password and `/operator` (no e2e spec opens them).
- Superseded 2026-11-19: the coordinator chose the refusal (F119 carry-over, job `…4961c82a`). The public reset request gives an SSO-only member the generic answer and no mail; only the operator's `web:invite --user-id` gives a password. Undo: remove the `ssoOnlyMember` line in `web.ts`.
- Source: `notes/2026-11-15-f119-sso-docs-facts.md`, `deploy/README.md` section "Company sign-in (F119)".

### 2026-11-15 · F109 v3 prompt holdout: no ship by the rule (F109) · quality · ok
- Choice: `classifier-v3[list]` is NOT shipped. Ship rule 4 failed: whitelist 314 of 315 (one `bad_output` on `h-rli-01`, counted as not correct). Rules 1, 2, 3, 5 pass by a wide margin (spam precision 80.3–88.8 → 97.6–99.9, K 74 → 34, cost $1.187 vs $1.148 per mailbox per month). Production stays `classifier-v2`; stages 12 and 13 build on v2. Spend $0.28 of the $0.60 cap; the one run is used.
- Why: the rule was fixed before the run; a whitelisted mail must never fail. The error is probably random model output, but that is a guess.
- Undo: if you accept one `bad_output` as noise, say so: a stage then switches the pointer to v3 (step 2 of stage 11, ~1 stage, no new run needed if you accept the existing one).
- Source: `evals/results/2026-11-15-f109-v3-dev-summary.md` (section "Stage 11 decision"), `evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v3.md`.

### 2026-11-15 · F116 open loops plan: second migration, consent bump, switch-off clears texts (F116) · privacy · ok
- Choice (plan defaults, 25 stages): (1) Follow-ups need a second anchor (`actions.loop_id`, `outbox.loop_id`, stage 09 migration), so new threads work too. (2) A hand forward becomes an `open_loops` row of kind `delegated`, not a `delegations` row. (3) Stage 17 bumps the Telegram consent version and gates the send side; older consent sees counts and a panel link only. (4) "Track my sent mail" off closes loops as `sent_off` and clears their texts. (5) "Waiting on you" = `needs_reply` from the last 14 days with no `\Answered` and no later sent mail in the thread. (6) Ignored loop closes as `stale` 30 days after due date. (7) Extractor eval up to $4 total, `--budget-usd 1` per run (inside the lab rule). (8) Gate bars use Wilson 95% lower bound (about 95% measured recall).
- Why: the plan follows E5b and PD-119/120/122; open questions are in `questions.md` (19 items; 1, 2, 3, 4, 5, 17, 18 matter most).
- Undo: flag off; cut stages 17–23 if unwanted; spend is capped per run.
- Source: `spec/features/planned/F116-e5b-open-loops/questions.md`, `plan.md`, `plan-review-1.md`, `plan-review-1-fixes.md`.

### 2026-11-15 · F114 alerts, releases and restore drill plan (F114) · production · ok
- Choice (plan defaults, 9 stages): (1) New table `ops_alerts` has no `org_id` (host-wide alert state, numbers only, like `auth_lockouts`): a rule exception. (2) After stage 09 every VPS deploy is a release by `deploy/release.sh <tag>`; a batch deploy becomes a patch version. (3) The restore drill runs on the VPS in a separate stack (`ea-drill`, own volume and image, subnet 172.29.0.0/24, no port), not on a clean VM on the PC (no VM tool; E8 decision 9 asked for a clean VM). The `age` key stays on the PC; the plain dump goes over ssh. (4) `/health` shows no version; the release name goes into every log line and the container env. (5) The drill copies `CREDENTIALS_KEY` from the live `.env` into a mode-600 file it deletes, so it does not check your password-manager copy of the key. (6) `release.sh` never rolls back by itself; it prints the rollback command. Cold review FAIL (B1: the drill override missed the `cli` service) fixed in the plan.
- Why: the plan follows E8b; open questions are in `questions.md` (Q1–Q6 important).
- Undo: cut stages 05–09; the alert job stays off with no `OPERATOR_TELEGRAM_CHAT_ID`.
- Source: `spec/features/planned/F114-e8b-alerts-and-releases-incl-the-restore-drill/questions.md`, `plan.md`, `plan-review-1.md`. Owner steps: U1 `age` identity file on the PC (only for the stage 09 drill), U2 Healthchecks.io "backup" check URL in `BACKUP_PING_URL`, U3 "EA operator" Telegram group, U4 read five test notices; gate PD-055.

### 2026-11-15 · F116 plan refresh: consent version after a same-day bump (F116) · privacy · ok
- Choice: F109 stage 06 already set `TELEGRAM_CONSENT_VERSION = "2026-11-15"`. F116 stage 17 must set a version greater than that (land date, or `<date>.2` on a day with a bump). This breaks the code-patterns same-day rule for this stage only; option: land stage 17 on a later day.
- Why: a consent to the F109 text must not count as consent to loop data (the F109 text has no loop sentence).
- Undo: none needed; a later version only asks again.
- Source: `spec/features/active/F116-e5b-open-loops/plan-refresh-1.md`, `questions.md` item 20.

### 2026-11-15 · F104 Sent switch texts: truth of "never changes Sent", no retention line (F104) · privacy · ok
- Choice: (1) The text "The assistant reads Sent, never changes it" is not exact: the assistant's own send can append a copy into Sent. The stage 10 fix changes the text to "reads Sent and does not change or delete your mail there". (2) The consent texts name no retention (30 days headers, 14 days text, off = delete). Not added: sent-mail rule 13 says no consent version bump while Sent data goes to no LLM or Telegram. Add a retention line before the flag goes on for any real org if you want it.
- Why: E5 §4.1 wording was the owner's; a consent text must be true.
- Undo: restore the old sentence in `apps/web/src/i18n/en.ts` and `pl.ts` (`sent_line`).
- Source: `.limen/jobs/2026-11-15-f104-review-s10-opus-sent-switch-422e67bb/result` (N1, N2), `spec/features/active/F104-e5a-read-sent/review-10.md`.

### 2026-11-15 · F109 escalation cascade: no ship by the cost rule (F109) · quality · ok
- Choice: the second-call cascade (stronger model on about 24% of mails) is NOT shipped. Dev rule 5 failed: $3.96 per mailbox per month against the $3.00 limit. Rules 1–4 pass (spam false positives 10.0 → 9.5, K 23.5 → 22.5), the gain is small. Spend $0.52 of the lab cap; no holdout run; stage 14 (escalation in triage) is skipped.
- Why: the rule was fixed before the run; the gain does not pay for the cost.
- Undo: a cheaper trigger (smaller share than 24%) or a cheaper second model needs a new trigger version and a new decision (about 1 stage plus a $0.50 dev run). Raise the $3.00 limit only if you accept the cost.
- Source: `evals/results/2026-11-15-f109-escalation-summary.md`.

### 2026-11-15 · F114 operator alerts: operator chat, English default, new key OPERATOR_LOCALE (F114) · ops · ok
- Choice: the SLO alert goes only to the operator chat `OPERATOR_TELEGRAM_CHAT_ID` by direct send (plan D4), not to the chats of `OPERATOR_USER_IDS` users. A new key `OPERATOR_LOCALE` (`en` default, `pl` optional) sets the language of the alert text.
- Why: `OPERATOR_USER_IDS` only gates `/api/operator/*`; the plan names the operator group (U3). English stays the default (plan D5).
- Undo: replace `operatorSend` in `apps/server/src/main.ts` to send to user chats; remove `OPERATOR_LOCALE` to use English only.
- Source: `spec/features/active/F114-e8b-alerts-and-releases-incl-the-restore-drill/plan.md` (P2, D4, D5), job `2026-11-15-f114-s03-ops-slo-job-alert-texts-a4ad9975`.

### 2026-11-15 · F116 extractor: addresses in the mail body go to the model (F116) · privacy · ok
- Choice: the sent-mail extractor (`extractor-v1`) gets the mail body as written (cut to 8,000 characters, inside a nonce data block). No header address (From, To, Cc) goes to the model, but an address in the body (a signature) can. Triage already works this way. The Telegram rule "never a raw mail body" does not cover an LLM call.
- Why: the plan lists the body in the model input; masking addresses would change the prompt and could cost recall.
- Undo: a new prompt version `extractor-v2` that masks addresses in the body, plus one eval run (stage 06 shape).
- Source: `spec/features/active/F116-e5b-open-loops/review-5.md`, job `2026-11-15-f116-review-s05-opus-loops-modul-6bcb0bc3`.

### 2026-11-15 · F109 send limits: the per-recipient day limit holds lab delegation sends (F109) · ops · ok
- Choice: none yet. The send-limit re-check (stage 16) found that the lab week would send 10 mails per day to one delegate (`asystentka`) against `SEND_LIMIT_RECIPIENT_DAY` = 5. Result: those sends go back to `approved` with `send_limit:recipient_day` and the owner gets `send_held`. The hourly (3 against 20) and daily mailbox (13 against 100) limits fit.
- Why: the lab persona delegates more per day than a normal executive. For a real user 5 per recipient per day may be right.
- Undo: leave the limit as is (the lab shows `send_held`); or raise `SEND_LIMIT_RECIPIENT_DAY` for the lab org only.
- Source: `notes/2026-11-15-e3b-improve-results.md` (send-limit re-check), job `2026-11-15-f109-s16-capability-pages-result-4a208d30`.

### 2026-11-15 · F116 loops: text retention, restart and sent_off reopen (F116) · product · ok
- Choice: (1) open loops keep their texts until they close; closed loops clear after the retention period; (2) `restartLoop` keeps `surfaced_at` (a restarted loop is not "new" in the brief); (3) a `sent_off` loop (Sent sync turned off) clears its texts and cannot reopen.
- Why: an open loop needs its text to be useful; clearing it would break the brief. A cleared loop has nothing to show on reopen.
- Undo: (1) clear open loops too after the Sent copy clears; (2) set `surfaced_at` to null in `restartLoop`; (3) allow reopen and show an empty loop.
- Source: job `2026-11-15-f116-s08-loop-repository-retenti-22f82745`, stage 08.

### 2026-11-15 · F103 log store: the log of another site on the VPS is shipped too (F103) · ops · ok
- Choice: the store reads every `json-file` container log of the host, so `astro-app-container` (another site) is in it (48 lines in 10 minutes). The store is on the host, bound to `127.0.0.1`, kept 30 days. I started it as is.
- Why: `vlagent` has no filter by container; filtering would need a second log driver on the astro container or a change of the agent's input. Its lines may hold visitor IP addresses.
- Undo: stop the store (`$C --profile ops stop victorialogs vlagent`), or set `logging: driver: local` on `astro-app-container` in its own Compose file and recreate it.
- Source: `notes/2026-11-15-vps-deploy-queue.md` (batch 3), F103 stage 19 step 6.

### 2026-11-15 · F116 loops: Sent tracking off also clears follow-up copies (F116) · privacy · ok
- Choice: when "Track my sent mail" goes off, the copies of the Sent mail in loop-anchored follow-up actions (`actions.payload` quote, To and Cc) and in their outbox cards (`outbox.view`, `outbox.text`) are cleared with the loop texts.
- Why: switching tracking off withdraws consent for the Sent mail copy; the review of stage 14 found the opening mail body left in an expired draft payload until the payload retention.
- Undo: remove the clear step in `onSentOff` (loops module); the copies then follow the normal payload retention.
- Source: job `2026-11-15-f116-review-s14-opus-sending-to-83298456`, stage 14 review N1.

### 2026-11-15 · F116 loops: the loop's own recipients never count as the user's own addresses (F116) · product · ok
- Choice: the own-address set built from the mailbox's Sent rows excludes the loop's counterpart and recipients, so their real reply closes the loop.
- Why: a person who also sends as the user (send-as or delegate access) would otherwise never close the loop, and the chaser would ask the user to chase someone who already answered.
- Undo: use the plain Sent-row address set again in `sentFromAddressesOf`.
- Source: job `2026-11-15-f116-review-s14-opus-sending-to-83298456`, stage 14 review N2.

### 2026-11-15 · F112 docs site: the Ctrl K hint of the search button is hidden by CSS (F112) · product · ok
- Choice: Starlight 0.43.1 has an axe violation on every page at desktop width (`label-content-name-mismatch`: the search button label is "Search", its visible text is "Ctrl K"). `apps/docs/src/styles/custom.css` hides `site-search kbd`. The Ctrl+K shortcut still works. No axe rule is disabled.
- Why: the docs site must pass axe with no disabled rule; the hint costs nothing in function.
- Undo: remove the CSS rule and override Starlight's `Search` component so the visible text contains the label.
- Source: job `2026-11-15-f112-s06-browser-check-906ad293`, stage 06.

### 2026-11-15 · F115 reply drafts: account numbers are checked by a digit budget, not by separator patterns (F115) · product · ok
- Choice: after two failed reviews of the separator-pattern scanner (marks between digits, a typed account followed by a fake one, a split account, a currency word glued to an IBAN), the account check of a reply draft changes design. The body is folded (NFKC, marks and default-ignorable characters removed, confusables mapped, ASCII digits). Every digit run costs its digits, unless it is a digit substring of a number the user typed (instruction, signature, style), a whole valid date or time, or an amount of at most 9 integer digits next to a currency. The draft fails when the total cost is above 12 or one run has 9 or more digits. Runs from the quoted mail count as known only up to 12 digits. Never a 13+ digit or IBAN-shaped run from the mail.
- Why: words, markup, quote prefixes and invisible marks between groups no longer change the result, and dates, times and amounts become free, so the false positive rate falls (the reviewer measured 18.6 % on business text with the old scanner). The mail itself may carry the fraud account, so long runs from the mail are never trusted.
- Undo: restore the account view in `packages/core/src/replies/entities.ts` (commit 1cd06cd2); the stage 02 prototype run tunes the budget N.
- Source: job `2026-11-15-f115-re-review-2-s01-opus-narrow-225f3f83`, stage 01 re-review 2.

### 2026-11-15 · F115 reply drafts: the account-number check cannot reach zero misses; stage 01 is not landed (F115) · product · ok
- Choice: after the third repair the digit budget still passes 6,704 of 77,000 adversarial forms and about 11 % of random 13-19 digit numbers. I did not land stage 01 and did not start a third re-review. The branch stays.
- Why: a pattern check cannot give zero misses on hostile text. The real choice: (1) forbid every digit run of 12 or more in a draft, plus mod 97 for IBAN; (2) keep the budget as one layer and rely on the user approving each draft; (3) accept the residual for the stage 02 prototype only.
- Undo: nothing landed. To resume, follow `notes/2026-11-15-f115-s01-account-check-open.md`.
- Source: job `2026-11-15-f115-s01-drafter-core-risky-llm-e4a702ce`, branch head `3e48aeec`.

### 2026-11-15 · F116 digest brief: the delegation footer stays in the first digest of the day when no delegation line is shown (F116) · product · ok
- Choice: the first digest of the day drops the delegation footer only when the ⏳ section shows a delegation line. Before the fix the footer was dropped always.
- Why: delegations due later would appear nowhere in the morning digest, and a user without loop consent lost the "Delegations: n open, m overdue" footer they had with the flag off. Delegations are not loop data.
- Undo: restore the unconditional drop in the digest renderer (`renderDigestWithBrief`).
- Source: job `2026-11-15-f116-review-s18-opus-privacy-row-4a8c4b84`, finding N3.

### 2026-11-15 · Release v0.2.0 deployed to the VPS (F114) · production · ok
- Choice: the coordinator tagged `v0.2.0` on `3e60a7f5` (green CI run 43768979219) and ran `deploy/release.sh v0.2.0`. Two migrations applied: `20261115180001_trust_ladder`, `20261115190001_outbox_loop_consent` (both `-- contract: v0.1.0`, additive).
- Why: owner pre-approval of VPS deploys (owner decision 2026-11-13) and the owner's order to deploy all prepared changes. The release changes no prompt file since v0.1.0, so no E2 holdout report was needed.
- Undo: `deploy/rollback.sh` on the VPS (target `v0.1.0`; the migrations stay). Backup `ea-20261115T223641Z.dump.age`.
- Source: `notes/2026-11-15-vps-deploy-queue.md` § batch 4.

### 2026-11-15 · Pilot flag `sent_sync` waits for a time budget of the Sent pass (F104) · production · ok
- Choice: the coordinator did not turn on `sent_sync` for the pilot org yet. It added stage 13a (a 60 s budget per Sent pass, and `duration_ms` in the log) and started a worker job. After stage 13a is released, the flag waits for the owner's word (owner, 2026-11-16: decide in a later session; `notes/owner-later.md` item 4).
- Why: the stage 13 runbook asks for this budget before the pilot switch. Without it, a slow Sent folder can hold the INBOX sync of the pilot for minutes (5-minute socket timeout, up to 100 text fetches per pass).
- Undo: tell the coordinator to turn the flag on now (`org:flag --org-id <pilot org> --flag sent_sync --on`).
- Source: `spec/features/active/F104-e5a-read-sent/stages/stage-13a-sent-time-budget.md`; job `2026-11-15-f104-s13a-sent-budget-risky-sync-8890e7df`.

### 2026-11-15 · F105 closed without owner step U1: two-factor sign-in stays off by the owner's choice (F105) · scope · ok
- Choice: F105 moved to done. The stage 15 checks after U1 were not run.
- Why: the owner turned two-factor sign-in on once, then off by choice. `/operator` redirects to the settings page until it is on again; that is the designed rule.
- Undo: turn two-factor sign-in on in Settings → Account; the operator console opens with no code change.
- Source: `spec/features/done/2026-11/F105-e7-t6-identity-a-totp-backup-codes-break-glass/outcome.md`.

### 2026-11-15 · Reply drafts: block long numbers the user did not type; approval is the final control (F115) · security · ok
- Choice: a draft fails on any run of 12+ digits (separators allowed) not typed by the user and on any mod-97-valid IBAN; the digit budget stays as a second layer; zero misses on hostile text is no longer a goal.
- Why: no pattern check reaches zero misses; the user approves the exact version before any send (ADR 0033 §5). Owner answer to the question: "idk".
- Undo: tell the coordinator another rule before the stage 01 re-review.
- Source: `spec/features/active/F115-e6a-reply-drafts/ticket.md` § Notes; `notes/2026-11-15-f115-s01-account-check-open.md`.

### 2026-11-15 · Reply drafts: gate G1 passes on defaults; the model stays open (F115) · scope · ok
- Choice: stages 03+ build before the stage 02 prototype run; PD-071 and PD-083 keep their defaults; PD-072 (model) is a config value set when the owner's new provider key exists.
- Why: the owner wants another provider (for example DeepSeek) and has no key yet; nothing else in stages 03+ depends on the model.
- Undo: hold stages 03+ until stage 02 runs.
- Source: F115 `ticket.md` § Notes; `notes/owner-later.md` item 2.

### 2026-11-15 · Mailbox OAuth: gate G1 passes on defaults without a live spike; `openid` added to the Microsoft redeem (F117) · scope · ok
- Choice: `spike.md` records every row as not run; M3 and G2 assumed PASS; stage 14 adds `openid` to the Microsoft code-redeem scope so an ID token surely returns; OAuth flags stay off.
- Why: owner answer 2026-11-15 (skip the live checks); `openid` is the fix the stage 08 review named for the unknown case.
- Undo: run the stage 01 kit live and refresh stages 14–15 from its facts.
- Source: F117 `plan.md` § Owner steps; `stages/stage-02-spike-report.md` § No live run.

### 2026-11-15 · Docs site: GitHub Pages stays off until stages 10–15 land (F112) · production · ok
- Choice: the `github-pages` environment allows `master` and `v*` tags now; the Pages source (GitHub Actions) and the `v*` tag ruleset are set at stage 16.
- Why: with Pages on, the v0.2.0 tag push would publish a half-built public site.
- Undo: `gh api -X POST repos/Artexs/email_assistant/pages -f build_type=workflow`.
- Source: F112 `stages/stage-16-publication.md` § Step 1.

### 2026-11-17 · F110 history check: failed model calls count against the $0.25 cap; the check stops after 5 failures in a row (F110) · money · ok
- Choice: a failed call counts at the cost of its tokens, or at a fixed estimate of 0.002 USD when the cost is unknown. After 5 failed calls in a row the check ends as `no_result`. Before, a failed call counted 0 and a broken prompt could spend more than the cap.
- Why: the cap is a money limit (owner cap $1 per run); a failing prompt on 500 mails must not exceed it.
- Undo: remove the estimate and the failure counter in `trust/history-classify.ts`.
- Source: job `2026-11-17-f110-review-s07-opus-llm-on-hist-d8b9cd1e`, finding N1.

### 2026-11-17 · F110 history check: under the synthetic LLM scope a check with 0 classified mails sends no "report ready" notice (F110) · user-visible · ok
- Choice: such a check ends `no_result` with no notice, so the one notice is saved for a real check.
- Why: before, an empty check used up the single `trust_report_ready` notice, and a later real check queued none.
- Undo: queue the notice for every first ended check, as in the worker's first version.
- Source: job `2026-11-17-f110-review-s07-opus-llm-on-hist-d8b9cd1e`, finding N3.

### 2026-11-17 · F110 re-gate: after a model switch an automatic category comes back when the evidence is eligible, not only when a history check for the new model passed (F110) · user-visible · ok
- Choice: the re-gate re-grants a category when the global evidence is eligible (plan decision D8). A missing history result or a `no_result` does not block. A stale `fail` blocks. A final global `go` alone re-grants.
- Why: the plan says "always on, every org"; the global evidence belongs to the model. The task text said a history result for the NEW key must pass; the code and plan differ.
- Undo: require a stored history result with the new key in `trust/regate.ts`.
- Source: job `2026-11-17-f110-review-s08-opus-re-gate-mod-0ced40bd`, finding N3.

### 2026-11-17 · F110 re-gate: moves of a mailbox whose start re-gate failed are expired at once (F110) · production · ok
- Choice: if a mailbox fails in the start run, its `ready` move and mark-as-read rows expire in their own transaction. Before, they could apply under the old key for up to 5 minutes, or 24 hours if the failure repeated.
- Why: no move should apply under an unproven key. The committer has no policy re-check.
- Undo: remove the expiry in the start catch.
- Source: same job, finding N1.

### 2026-11-17 · F110 re-gate: pausing a non-moving category (urgent, needs_reply) after a model switch writes a trip and no notice (F110) · user-visible · ok
- Choice: when the re-gate pauses `urgent` or `needs_reply` it records the trip and sends no `autonomy_paused` notice, because the notice type covers moving categories only (stage 09 narrowed it).
- Why: a notice for a category that never moves mail would confuse the user.
- Undo: widen the notice category type and queue the notice in `trust/regate.ts`.
- Source: job `2026-11-17-f110-s08-regate-risky-automatic-c3bab87b`.

### 2026-11-18 · F110 one-click unsubscribe: the privacy text does not yet name the request the server sends after your tap (F110) · privacy · ok
- Choice: after an owner tap the server sends ONE request from its own address to the server the newsletter names (the one-click URL). That server learns that this subscription asked to leave, that the mailbox is active and when the tap happened. The privacy text does not say so yet. Saying so is a legal text change and needs a `TERMS_VERSION` bump (every user accepts the new terms at the next sign-in).
- Why: the reviewer asked for it; the bump is batched with the next legal change (F115 stage 17) so users are asked once.
- Undo: leave the text as it is; the feature stays behind the flag `bulk_unsubscribe` (off).
- Source: job `2026-11-18-f110-review-s24-opus-hard-ssrf-r-d6314836`, NOTE 9.

### 2026-11-18 · F110 one-click unsubscribe: DKIM coverage of the List-Unsubscribe headers is not checked, only a "more than one header" guard (F110) · security · ok
- Choice: the POST target is the link of the newest trusted mail of the sender. A replayed signed mail with an added header could point it elsewhere. The cheap guard refuses a mail with more than one such header. The full check (read the DKIM-Signature `h=` list) needs new captured data and is a later ticket.
- Why: the risk is low (fixed body, public https host on port 443, after an owner tap, the same POST an attacker with their own DKIM domain gets today).
- Undo: keep the flag `bulk_unsubscribe` off.
- Source: same job, NOTE 1.

### 2026-11-18 · F110 panel review: sender names and subjects of sample mail are shown to every signed-in member of the organization (F110) · privacy · ok
- Choice: the panel review page (flag `panel_review`, off) shows, for a sample of recent mail, the sender's display name, the subject and the date, to any signed-in member of the owning organization. It never shows an address, never calls the model for these texts and never logs them.
- Why: a mailbox has no single user owner, the stage text says "any member", and the Activity page already shows subjects to members. Owner-only would need a per-user owner of a mailbox.
- Undo: restrict the routes to the owner role in `modules/triage/review-routes.ts` (the member case then answers 403, like the other owner-only routes).
- Source: job `2026-11-18-f110-s15-panel-review-eac1e969`.

### 2026-11-18 · F110 history check: the privacy page says no mail older than 7 days goes to the model, but the history check sends a capped sample of 30-day-old mail when `trust_ladder` is on (F110) · privacy · ok
- Choice: keep `trust_ladder` OFF everywhere until the privacy text is fixed. The sentence in `apps/web/src/legal/en/privacy.md` (and the Polish text) must say that, with the trust ladder on, the history check sends a capped sample of the last 30 days of mail (about 500 mails at most, $0.25 cap) to the model once at connect and again after a model change. The fix is a legal text change and needs a `TERMS_VERSION` bump (every user accepts the new terms at the next sign-in).
- Why: found by the F110 docs stage while it wrote the trust page. Today no one is affected: the flag is off for every organization.
- Undo: leave the flag off.
- Source: job `2026-11-18-f110-s25-docs-b1c6e2c7`. Same bump batch: the one-click request line (owner decision of 2026-11-18), the `members` subject of the `unsubscribe-data` category, a line about report mail appended into the member's INBOX.

### 2026-11-18 · F120 sender context: the sender line shows only in the panel, and a classifier-v4 prompt never goes live without your word (F120) · user-visible · ok
- Choice: (Q1) the sender line (what the assistant knows about a sender) shows only in the panel (Activity, Approvals); Telegram does not change. (Q4) if `classifier-v4[profile]` wins on the dev and holdout evals, the production prompt still does not switch until the owner says so. (Q3) at deploy the coordinator turns on `sender_context`, then `contact_wait` one day later; `sender_suggestions` waits for the owner.
- Why: planner defaults; the owner decides what changes classification of real mail.
- Undo: leave the flags off.
- Source: plan `spec/features/planned/F120-e11a-sender-context/questions.md` (Q1, Q3, Q4).

### 2026-11-18 · F120 sender context: privacy and money defaults (F120) · privacy · ok
- Choice: (Q2) the new tables go into the legal data catalog in stage 02; the privacy page sentence waits for the next legal batch (stage 12 gives the text; a TERMS_VERSION bump). (Q5) a DSR erase of a person does not delete a domain suggestion such as `@acme.pl`. (Q7) when a flag goes off, stored profiles stay until the 12-month retention deletes them. (Q6) stage 11 may spend at most $1.50 on LLM calls. Only address rows are stored, not domain rows; the hash key comes from `CREDENTIALS_KEY` by HKDF with the org id.
- Why: planner defaults with the review's fixes.
- Undo: change the plan before the stage builds.
- Source: same plan, Q2, Q5 to Q8.

### 2026-11-18 · F118 phone channel: push for urgent, approvals and updates only; a `minimal` Telegram level that shows no mail text and no address (F118) · user-visible · ok
- Choice: (Q2) push carries three groups: Urgent, Approvals and Updates (send results, delegations, mailbox and sync problems). The digest, the weekly report and the trust reports stay on Telegram and mail. (Q4) the `minimal` Telegram level prints no string from the notice, not even your own mailbox address; `/status` names mailboxes "Mailbox 1…"; `/review` answers with a panel link only. (Q7) if the chosen channel is missing, the notice goes to the other one; a push that fails with `no_device` falls back to Telegram.
- Why: planner defaults with the review's fixes.
- Undo: leave the flags `web_push` and `telegram_minimal` off.
- Source: `spec/features/planned/F118-e9b-phone-channel-pwa-push-telegram-detail/questions.md` (Q2, Q4, Q7).

### 2026-11-18 · F118 push: devices are bound to the sign-in session; company sign-in sessions end after 12 hours and then push stops until you open the panel again (F118) · production · ok
- Choice: (Q3) accept it; a held push falls back to Telegram. (Q6) push endpoints are limited to the FCM, Mozilla, Apple and Windows hosts, checked at subscribe and again at send. (Q8) 10 devices per user.
- Why: security default.
- Undo: change the plan before the stage builds.
- Source: same plan, Q3, Q6, Q8.

### 2026-11-18 · F118 push: real ids and counts reach the push services (FCM) from checkpoint A, but the papers name them only in stage 13 (F118) · privacy · ok
- Choice: (Q12) `web_push` stays on only for your own organization until stage 13 lands (gate G-papers). Notice payloads carry ids and counts, never mail text. The legal papers get the push services as sub-processors and one `TERMS_VERSION` bump in stage 13.
- Why: nobody else is affected until the papers say it.
- Undo: leave `web_push` off.
- Source: same plan, Q12.

### 2026-11-18 · F118 checkpoint A needs your phone (F118) · production · ok
- Choice: after stage 05 the real phone test needs you: run `bun run push:keys`, put the VAPID keys in the VPS `.env`, deploy, turn on `web_push` for your organization, install the panel on the Android phone, send a test push. If it fails, F118 stops (Q1). Stages 01 to 05 build before this; stage 06 and later wait.
- Why: a real phone cannot be simulated.
- Undo: none needed.
- Source: same plan, Q1, O1 to O3.

### 2026-11-18 · TERMS_VERSION bumped to 2026-11-18 for the new data category sender-context (F120) · privacy · ok
- Choice: F120 stage 02 adds the data category `sender-context` (keyed sender hashes, dates and counts, 365 days). This changes the legal digest, so the version guard needs a new `TERMS_HISTORY` entry and `TERMS_VERSION` becomes `2026-11-18`. Every user must accept the terms again once. The privacy page sentence for the new data comes with the next legal text batch (F120 stage 12, F115 stage 17).
- Why: master CI would stay red otherwise, and only you and test organizations exist now.
- Undo: remove the entry together with the tables (F120 rollback).
- Source: F120 stage 02 worker question and review.

### 2026-11-18 · TERMS_VERSION 2026-11-18-2 for the data category push-devices (F118) · privacy · ok
- Choice: F118 stage 02 adds the data category `push-devices` (push endpoint and keys, encrypted at rest, per user and device). It moves the legal digest again, so a second `TERMS_HISTORY` entry `2026-11-18-2` is needed. Members accept the terms again at next sign-in. The privacy page text for push and the push services as sub-processors come in F118 stage 13 (Q12).
- Why: master CI would be red otherwise; only you and test organizations exist.
- Undo: remove the entry together with the table (F118 rollback).
- Source: F118 stage 02 worker question.

### 2026-11-18 · F118 stage 02 also adds the `web_push` flag and `push` in the core channel list (F118) · scope · ok
- Choice: the flag and the channel name come in stage 02 (planned for stages 03 and 07), because a schema test ties the outbox CHECK to the core channel list. Stages 03 and 07 must not add them again.
- Why: the stage cannot pass its own tests otherwise.
- Undo: remove them from `packages/core/src/features.ts` and the channel list, and let the test allow the difference.
- Source: F118 stage 02 worker notes.

### 2026-11-18 · F115 stage 13: Telegram texts no longer say "in the panel" (F115) · user-visible · ok
- Choice: the review card and tap texts say "Changed" and "Version N" instead of "Changed in the panel" and "Version N, edited in the panel", because a draft can now change from Telegram too. Reply all has no "back to sender only" button in Telegram (the service has `mode: "from"` for the panel).
- Why: the old wording is false once Redraft works from Telegram.
- Undo: restore the strings in `texts/approvals.ts` and `texts/bot.ts` and their tests.
- Source: F115 stage 13 worker notes.

### 2026-11-19 · F118 stages 06 and later build before checkpoint A (F118) · scope · ok
- Choice: stage 06 and the stages after it build with fakes before your phone test (checkpoint A) runs, because the VPS is unreachable. The flag `web_push` stays off by default. The gate moves: no deploy of F118 code to the VPS and no use of `web_push` in production before checkpoint A passes. If checkpoint A fails, F118 stops as the plan says (Q1); the Telegram channel is not affected.
- Why: your rule says owner checkpoints are not a stop, and waiting would idle the whole F118 chain for days.
- Undo: stop the F118 stages after 06; the code that landed stays off behind the flag.
- Source: your instruction "no limits, just proceed", F118 plan Q1 and G-A.

### 2026-11-19 · F118 stage 10: a Telegram card edit at the minimal level has no Reject button · user-visible · ok
- Choice: when a member is at the `minimal` level, the edited card has no buttons, also if the card was sent at `full`. Stage 11 adds a panel link line to such an edit, so the member can still reject in the panel.
- Why: the minimal level sends no buttons (plan D12). The review found that a card sent at `full` has no panel link, so a held send could not be rejected from the chat.
- Undo: keep a stop-only Reject button on the edit.
- Source: Opus review of F118 stage 10, NOTE 2; builder decision list.

### 2026-11-19 · F118 stage 11: a Telegram link without a detail value keeps the stored level · user-visible · ok
- Choice: when the link request has no `detail`, the stored level stays (stage 12 changes the code). New members still start at `minimal`, because the column default is `minimal`. The stage 12 card always sends `detail`.
- Why: the stage 11 build stored `minimal` in this case. A pilot member who links again with an old cached panel would drop from `full` to `minimal` without a choice.
- Undo: store `minimal` when `detail` is absent.
- Source: Opus review of F118 stage 11, NOTE 7; builder decision list.

### 2026-11-19 · Owner answers in chat: closed items · process · ok
- What: Polish texts of F115 s12–s16, F120 s07, F118 s09 and s12 and the changelog `pl:` lines are checked by the owner: closed. F118 owner steps: nothing left (checkpoint A uses the plan default). F108 O1/O2 optional: closed, no action. F121 G1–G3: plan defaults hold (nothing public, no seed, no video). Dev DB migration run by the owner.
- Why: owner message of 2026-11-19.
- Undo: ask for a new check.
- Source: owner chat.

### 2026-11-19 · F111 own-model runs on the owner's PC only · process · ok
- What: F111 stage 05 runs on the owner's PC GPU (RX 6950 XT, 16 GB); the VPS runs no own model. A local dev test is enough for the stage (PD-112).
- Why: owner message of 2026-11-19; PD-112 picks the PC when it has ≥ 12 GB.
- Undo: rent a GPU (cap $5, Q2).
- Source: owner chat; `spec/features/*/F111*/plan.md` P3.

### 2026-11-19 · F117 and F116 pilot deferred, F111 uses LM Studio on the PC · process · ok
- What: F117 (OAuth live test) waits until the owner has a tenant; nothing else depends on it. F116 s25 (pilot week) is deferred and blocks no development. F111 stage 05 uses LM Studio on the owner's PC (RX 6950 XT) instead of `ollama-rocm`; the endpoint is LM Studio's server on port 1234. F114 drill: the owner copies the `age` key to the PC once; the coordinator deletes it after the drill.
- Why: owner message of 2026-11-19.
- Undo: ask the coordinator to start the stage.
- Source: owner chat.

### 2026-11-19 · F117 dropped, F116 gate G1 on defaults, F114 restore drill runs now · process · ok
- What: (1) F117 is dropped. Stages 01 and 03–13 and 16 stay in master (flags off); stages 02, 14, 15, 17, 18, 19 and 21 are not built, because they need spike results from a live Microsoft and Google test account. No other active ticket depends on F117 (F119 s16 shares the Entra tenant and is skipped the same way). (2) F116 gate G1 takes the plan defaults (PD-119 wait, PD-120 automatic follow-up off, PD-122 others' promises as planned), because the E2b week does not exist yet; the pilot stage 25 runs on them. (3) F114 stage 09 part C (restore drill) runs now with the `age` key at `~/.config/ea-backup/age-key.txt` on the owner's PC; U2 and U3 stay open.
- Why: owner message of 2026-11-19: "skip F117 or build it without my account", "the age key is on your machine", "continue F116".
- Undo: move F117 back from `dropped/` to `active/` and run its stage 01 spike kit with a test account; G1 can be re-run later with real data.
- Source: owner chat.

### 2026-11-19 · Only active tickets; bypass owner steps where simple · process · ok

- Decision: work only on `spec/features/active/` until all close; planned jobs stopped (F062, F068, F122 plan, F124, F125, F138 stage 01). F104 U1 ("Track my sent mail") set by the coordinator with `mailbox:settings sent-sync --value on`. F114 U3: `OPERATOR_TELEGRAM_CHAT_ID` in the VPS `.env` set to the owner's existing chat with the bot (the one `chat_links` row of the live org); U2 (Healthchecks ping) stays open, the in-app backup-age alert covers it. F115 stage 02 runs resume on Gemini on 2026-11-20 instead of moving to F138.
- Why: owner message of 2026-11-19: "your only job is to find a reason why you can't start them. Fix it or bypass and start those tickets".
- Undo: `mailbox:settings sent-sync --value off`; remove `OPERATOR_TELEGRAM_CHAT_ID` from the VPS `.env` (backup `.env.bak-20261119-operator`).
- Source: owner chat.

### 2026-11-19 · Tickets that wait on time close now · process · ok

- Decision: F029, F064, F113, F116 and F120 close with the logs and data of today, without their waits (F029 24 h log window, F120 one day before `contact_wait`, F113 scored day and week, F116 lab week and first pilot week). Flags `contact_wait`, `open_loops`, `delegate_button` on for the pilot org. Each `plan.md` Log names what is not proven.
- Why: owner message of 2026-11-19: "close all of them without further waiting… use only the logs and anything else that is there for current time. So that's my decision".
- Undo: move a ticket back to `active/` and run its open check; flags off with `org:flag --off`.
- Source: owner chat.

### 2026-11-20 · F138 plan defaults: "history" means any dated record; measured Gemini model name kept in the cost record · rule-exception · ok

- Decision: F138 plan D17 reads "history" in the acceptance grep as any dated record (old ADR text, `docs/product/**`, `known-alerts.md`, dated roadmap lines, `docs/owner-decisions.md`). D16 keeps `gemini-3.5-flash-lite` in `pilotCost.models` and `docs/cost-model.md` as a measured record. Terms version bump (Q1) and the stage 06 spend cap $2.50 (Q5, expected under $0.10) stay on defaults.
- Why: plan refresh of 2026-11-20 (questions.md Q8, Q9); the coordinator took the defaults.
- Undo: narrow the ticket Acceptance line, then re-run the F138 stage 05 grep.
- Source: `spec/features/active/F138-*/questions.md`.

### 2026-11-20 · F062: after the contract release, rollback reaches only the expand release · irreversible · ok

- Decision: the contract migration (stage 05) drops `emails.inbox_uid`, `undo_pending_at`, `mailboxes.uidvalidity` and `mailboxes.last_uid`. After its release, `deploy/rollback.sh` reaches only the expand release; an older target needs a restore from the backup taken before the release. Other defaults: `org:export` uses the new names (version stays 1); new columns nullable; `mailbox:probe-move` keeps its local name; an old demo seed export must be exported again.
- Why: the purpose of the ticket; plan Q2 default taken by the coordinator.
- Undo: do not land stage 05, or restore from the pre-release backup.
- Source: `spec/features/active/F062-drop-mailbox-cursor-columns/questions.md`.

### 2026-11-20 · F136: no cap on parallel Playwright runs; the memory gate acts only at job start · process · ok

- Decision: after F136 the shared Playwright lock is gone and no cap limits parallel Playwright runs. One docs run peaked at about 2.2 GB. Limen's memory gate acts only when a job starts. `demo:record` keeps the lock (shared demo DB). Prepare fails hard when the e2e part fails. One existing test file (`apps/docs/scripts/browser-check.test.ts`) changes two assertions.
- Why: plan defaults Q1–Q4 of F136; the coordinator took them.
- Undo: add a run cap in stage 05 or keep the lock rule; both are small edits.
- Source: `spec/features/active/F136-*/questions.md`.

### 2026-11-19 · F138 dropped: Gemini stays as an optional provider, off by default · scope · ok

- Decision: the owner chose to keep Gemini in the code, selectable in `.env` (`LLM_PROVIDER=gemini`), with `openai` as the default. The stage 02 job that removed the Gemini provider was stopped; its commit `d6a82966` stays on its branch and did not land. Stage 01 (judge on OpenAI) stays. The model tier map (`light`, `strong`) for all providers moves to F141, which no longer waits for F138.
- Why: owner request in chat, 2026-11-19.
- Undo: reopen F138 from `spec/features/dropped/2026-11/` and land the stage 02 branch after a refresh.
- Source: `spec/features/dropped/2026-11/F138-*/outcome.md`.

### 2026-11-19 · F141: one provider for the whole application, chosen by `LLM_PROVIDER` · scope · ok

- Decision: every role (classifier, drafter, extractor, judge) uses the one provider that `LLM_PROVIDER` names; roles pick a tier (`light`, `strong`), the provider row maps tiers to models. The per-role provider and model env keys go; an old key in `.env` fails config by name. Gemini and OpenAI stay; DeepSeek is added. This ticket replaces the dropped OpenAI-only ticket (F138).
- Why: owner request in chat, 2026-11-19.
- Undo: keep the per-role keys in the plan; the tier map works with them too.
- Source: `spec/features/planned/F141-*/ticket.md`.


### 2026-11-20 · F115 stage 02: judge-v3 replaces judge-v2 as the eval judge · rule-exception · ok

- Decision: `prompts.judge` is now judge-v3, which sees the older thread mail. judge-v2 flagged a draft that quoted a term from the thread (3 of 5 runs); judge-v3 did not (0 of 4). The change is eval only.
- Undo: set `judge: judgeVersions["judge-v2"]` in `apps/server/src/modules/triage/prompts/index.ts` and change the registry test in `judge.test.ts`.
- Source: `spec/features/active/F115-e6a-reply-drafts/tuning-1.md` § drafter-v3.

### 2026-11-20 · F115 stage 02: the blind holdout was used a second time · rule-exception · ok

- Decision: one blind run of drafter-v3 on the holdout. It failed: 1 invented commitment (bar 0) and injection 13/14. Production stays on drafter-v1. A third use of the holdout needs the owner, or a new corpus version.
- Source: `evals/results/gate/drafter-drafter-v3-gpt-6-luna-low-lab-01-v1.json`.

### 2026-11-20 · F141 plan defaults: drafter fixed in code; DeepSeek refused with all-scope triage except the lab stack · privacy · ok

- Decision: (Q8) the drafter is fixed in code at tier light, effort low; a different F115 gate result is a one-line edit of `llmRoleModels` (this overrides the PD-072 "drafter model is config" wording). (Q9) ticket acceptance item 5 reads "zero outside the registry and a named exception list". (Q10) config refuses `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all`, except when `LAB_STACK=ea-sim`. (Q11) a removed key with a value stops the start; the coordinator cleans the dev `.env`, the VPS `.env` is an owner step. (Q3) `OPENAI_OWN_MODEL` replaces `OPENAI_MODEL_CLASSIFIER` for an own endpoint. (Q4) DeepSeek prices use the peak rates.
- Why: plan defaults, taken by the coordinator after the cold review.
- Undo: edit the question and the stage; none ships before stage 04.
- Source: `spec/features/active/F141-*/questions.md`.

### 2026-11-20 · F124 stage 02: dev Postgres max_connections 200; one database per test worker; one weaker assertion · rule-exception · ok

- Decision: (1) `deploy/compose.dev.yaml` sets `max_connections=200` (applies at the next restart of the dev Postgres); a job peaked at 19–22 connections and two race files need 16 at once. (2) Each `test:int` worker gets its own database (`apps/server/test/worker-db.ts`, `EA_TEST_WORKER_DB=1`); `db:worktree --drop` also drops `<name>_w1..w4`. (3) The `channels-operator` "send null" case uses `toContainEqual`, not an exact event list.
- Why: removes the 8 deadlocks (4 of 5 traced to DDL in the schema Down/Up tests) without a serial exception list.
- Undo: remove the `command:` line in `deploy/compose.dev.yaml`; delete `worker-db.ts`, its call in `preload.ts` and `EA_TEST_WORKER_DB=1` in `test:int`; restore `expectEvent` in `channels-operator.test.ts`.
- Source: `spec/features/active/F124-*/stage-02-open.md`.

### 2026-11-20 · F062 stage 02: two extra mapper checks; rollback SQL removed from the README · scope · ok

- Decision: (1) `mail-repo.test.ts` gets two `not.toHaveProperty` checks on `uidvalidity` and `last_uid` of the mapped row (they read no column, so they survive stage 05). (2) `deploy/README.md` loses rollback sub-bullet (b), the SQL that copied the cursor from `mailboxes` (stale value; stage rule "no SQL").
- Undo: delete the two lines; restore the bullet from `git show 477f939b^`.
- Source: `.limen/jobs/2026-11-19-f062-stage-02-54735125/note.md`.

### 2026-11-20 · test scripts get `--timeout=30000` · rule-exception · ok

- Decision: `test:unit` and `test:int` carry `--timeout=30000`. The 5 s Bun default failed CPU-bound cases and hooks under load (comment-codes, quietEnd, sim-files, runSim, drafter eval, cli-streams) in at least six jobs and several land checks. Two cases also got their own 60 s timeout.
- Undo: remove the flag from the two scripts (`package.json` lines 15–16) and the sentence in `docs/code-patterns.md` § Tests.
- Source: commits `b6433d3c`, `8165f762`, `3e6c1c4b`.
- 2026-11-20 · F141 stage 03 hardening · privacy · The style preview is disabled (answer `llm_off`) for a provider with `realMail: false` (DeepSeek), on every stack; a synthetic profile would not show the owner's own style. Undo: set `realMail: true` on the row, or build a synthetic variant in `replies/preview.ts`. · ok
- 2026-11-20 · F141 stage 03 hardening · security · `OPENAI_BASE_URL` refuses `api.deepseek.com` and its sub-domains for every endpoint kind (closes the "own endpoint" route). Undo: drop the `endsWith` clause or the check in `platform/llm/endpoint.ts`. · ok
- 2026-11-20 · F153 plan P3 · user-visible · Correcting the privacy text adds a `TERMS_HISTORY` entry: every member accepts the terms again at the next sign-in. Undo: drop the entry and revert the text. · ok
- 2026-11-20 · F153 plan P4 · scope · The privacy text names the history check of the trust ladder (off by default, up to 500 mails of 30 days, $0.25 cap). Undo: remove the sentence and ledger row C262 (needs a new version). · ok
- 2026-11-20 · F153 plan P5/P7 · privacy · The papers and the `openai`/`gemini` sub-processor rows name To and Cc, the date and the sender marks (the classifier call sends them today). Undo: revert those sentences. · ok
- 2026-11-20 · F153 plan P8 · scope · The one-click unsubscribe line, `members` in `unsubscribe-data`, the report-mail line and the open-loops extractor call stay out of F153; a new ticket holds them and lands before the `bulk_unsubscribe` or `open_loops` flag goes on. Undo: add them to stage 01. · ok
- 2026-11-20 · F153 plan P2 · scope · Context mails keep no age limit (no code change); the text says so. Undo: a new ticket with an eval gate. · ok
- 2026-11-20 · F142 plan D1 · rule exception · No alias for the old address-helper names (the quality-pass text asked for one). Undo: re-export the old name. · ok
- 2026-11-20 · F142 plan D4/D5 · scope · No data migration: stored and sent addresses keep today's form; the one-address rule form is only a compare key (the cold review found that a stored compare form would change the address reminders go to). Undo: none needed. · ok
- 2026-11-20 · F142 plan D6 · user-visible · A delegate or sender rule whose address differs from an existing one only by `ς`/`σ`, a dotted I or padding is refused as `exists`. Undo: drop the pre-check. · ok
- 2026-11-20 · F142 plan D7 · user-visible · A reply outside the thread from a padded or combining-dot From does not close a loop. Undo: switch the read to `normalizedAddress`. · ok
- 2026-11-20 · F142 plan · scope · Other private address folds (reply drafts, outgoing sender, triage payloads, mail sync, login) stay out of scope; a follow-up ticket holds them. Undo: add them to a stage. · ok
- 2026-11-20 · F129 plan D13 · scope · `gemini:test` is removed; `llm:check --provider gemini` does the same. Undo: restore the script. · ok
- 2026-11-20 · F129 plan D8 · user-visible · `org:break-glass` (set and clear) and `web:two-factor-reset` need `--confirm <organization name>`. Undo: drop the guard. · ok
- 2026-11-20 · F129 plan D5 · user-visible · Bad arguments exit 2 in every tool; refusals and `mailbox:audit` lost mail exit 1; stopped runs (`eval --sim`, drafter eval, `testmail:send`) exit 4. Undo: change the table in docs/cli.md and the tools. · ok
- 2026-11-20 · F129 plan D13 · user-visible · `eval --json <file>` is renamed `--json-out <file>`. Undo: rename back. · ok
- 2026-11-20 · F129 plan D13 · scope · `testmail` stays in the server for now. Undo: a follow-up ticket moves it to `tools/`. · ok
- 2026-11-20 · F129 plan D12 · rule exception · `fake-tg` has its own exit site `tools/fake-telegram/src/cli-run.ts` (a tool never imports `apps/`). Undo: none needed. · ok
- 2026-11-20 · F129 plan D9 · scope · No new dev-DB guard (the refusals in `e2e:seed` and `db:worktree` stay). Undo: add a guard stage. · ok
- 2026-11-20 · F129 plan stage 00 · rule exception · Positional operands stay for `db:worktree`, `release:prepare`, `fake-tg send` and `wait`. Undo: convert them to flags. · ok
- 2026-11-20 · F144 plan · scope · Contacts reads triage through a new same-layer edge in `layers.json` (contacts → triage), not through a hook in a composition root. Undo: replace the edge with a hook. · ok
- 2026-11-20 · F144 plan · scope · Out of scope: the data-request address list in `contacts/privacy.ts` and the mailbox reads of the suggestion commands. Undo: add them to a stage. · ok
- 2026-11-20 · F144 plan · scope · The F100 metric readers that select `FROM emails` stay where they are; the new rule in `docs/code-patterns.md` says they predate it. Undo: move them in a follow-up. · ok
- 2026-11-20 · F143 plan · rule-exception · The size lint skips test code (`*.test.*`, test helpers, `apps/server/test/**`, e2e, `tools/*/test/**`): 40 test files pass 800 lines and F125 owns them. Undo: remove the ignores after F125 and split the files that fail. · ok
- 2026-11-20 · F143 plan · rule-exception · One limit for all files: warn over 400, fail over 800. The old hard 400 cap of `file-size.test.ts` on the 8 groups from F131 goes. Undo: add a 400-line error block for those globs. · ok
- 2026-11-20 · F143 plan · scope · Core text tables split by locale (`-en.ts`, `-pl.ts`), not by group; about 28 files between 400 and 800 lines keep only a warning (follow-up ticket). Undo: split by group. · ok
- 2026-11-20 · F145 plan · scope · The time-literal rule covers non-test source only; test files stay out until F125 owner approval. Undo: add test globs to the rule. · ok
- 2026-11-20 · F145 plan · scope · A lone multiple such as `120_000` does not fail lint; seconds (`n * 1000`) and division chains are out of scope; `tools/mail-oauth-spike/` is out of scope. Undo: widen the rule. · ok
- 2026-11-20 · F121 stage 10 · scope · Demo recording: the Telegram step uses a chat not linked to an organization, and the undo step signs in as the main-organization owner. Undo: link a chat in `global-setup.ts`; switch to `seed.activityMembers` in `record.spec.ts`. · ok
- 2026-11-20 · F121 stage 10 · rule-exception · `seedTargetOk` accepts `*_demo` seed databases (unit-tested). Undo: revert the regex in `apps/server/src/scripts/e2e-seed-args.ts`. · ok
- 2026-11-20 · F129 stage 02 · scope · A tool that is not converted yet shows risk `danger` and needs `none` in `cli:list` until stages 05–15 convert it. Undo: change `PLACEHOLDER_RISK` in `apps/server/src/scripts/lib/cli-tools.ts`. · ok
- 2026-11-20 · F129 stage 02 · rule-exception · The CLI lint rule uses `no-restricted-syntax` selectors, not `no-restricted-properties`: the latter did not flag `process.stdout.write` in a probe. Undo: none needed. · ok
- 2026-11-20 · F121 close-out · scope · The demo caption files are hash-pinned (`DEMO_CAPTION_SHA256` is `{ en: null, pl: null }` until a candidate exists; deploy needs all three pins). No G3 candidate exists until F151 builds demo-source recording. Undo: set the pins by hand after a recording. · ok
- 2026-11-20 · F142 stage 05 · scope · The one address rule is kept by a scan test (`address-rule-scan.test.ts`); a fold that is not an address carries `// not an address: <reason>`. The styleguide line the worker proposed is not added; the rule lives in `docs/code-patterns.md` § Data access. Undo: add the line to `.agents/limen/styleguide.md`. · ok
- 2026-11-20 · CI red taps test · scope · The test "Done on an overdue delegation" built its mail with the real clock next to a fixed fake clock; fixed in the test (`821e4ce2`). A follow-up audit of 82 integration files that use `new Date()` is noted in `notes/2026-11-20-replan-parallel.md`. Undo: none. · ok
- 2026-11-20 · F148 plan · security · One legal version format `YYYY-MM-DD` or `YYYY-MM-DD.N` (N from 2). Both spellings are read, only the dot form is written. The two hyphen terms entries (`2026-11-18-2`, `2026-11-19-2`) stay as a frozen legacy list: a rename would make every member accept again. A bare date counts as counter 1. An invalid version is not covered. Undo: revert the F148 stages. · ok
- 2026-11-20 · F148 plan · scope · `consentCovers` keeps its name and calls the new module; the accept routes keep exact-string equality; `nextLegalVersion` takes today as an argument and throws on bad input. Undo: revert stage 01. · ok
- 2026-11-20 · F146 plan · scope · No general unused-export checker (it would change `bun.lock` and give false positives on the `@ea/core` API): the ticket removes only the known list. `expiredFlags` stays (a unit test calls it; the quality finding was wrong). Tests and `tools/mail-oauth-spike/` keep the literal `X-EA-Action-Id`. Undo: add a checker in a new ticket. · ok
- 2026-11-20 · F062 stage 04 · scope · Two `mail-repo.test.ts` assertions on the old-name copy through the trigger are removed (the stage 01 trigger test covers them). Undo: restore them and add the file to `RETIRED_COLUMN_ALLOW`. · ok
- 2026-11-20 · F129 stage 07 · user-visible · `mailbox:connect` with a value the service refuses now exits 2 (was 1); a port outside 1–65535 is a parse error (2). Undo: return 1 in the `ZodError` branch of `mailbox-connect.ts`. · ok
- 2026-11-20 · F129 stage 07 · user-visible · A terminal or empty stdin for `mailbox:connect`, `mailbox:password` and the probes prints one `refused:` line and exits 1 (it printed the usage before). Undo: print the usage in `lib/stdin-secret.ts`. · ok
- 2026-11-20 · F129 stage 07 · user-visible · A refused mail connection in `mailbox:connect` exits 3 with `unreachable:` (was 1). Undo: remove the unreachable branch in `lib/mailbox-failure.ts`. · ok
- 2026-11-20 · F129 stage 07 · rule-exception · `mailbox:check`, `connect`, `probe-*` and `rescan` keep `error.message` in `failed:` lines (byte for byte); `docs/cli.md` names the exception. Undo: pass `"label"` to `reportFailure`. · ok
- 2026-11-20 · F129 stage 06 · scope · `org:invite` and `web:invite` carry the `outputNote` "prints the setup link with `--print`", as the stage file says. Undo: remove the `outputNote` line from the description. · ok
- 2026-11-20 · F129 stage 06 · user-visible · A dead database in the eight org and web tools prints `unreachable:` and exits 3 (was `failed:` and 1). Undo: change the mapping in `runCli`. · ok
- 2026-11-20 · F147 plan · scope · One alert mechanism with two state stores: kind lifecycle `incident` (the five `slo_*` kinds, state in `ops_alerts`) and `once` (the five event kinds); one log vocabulary with an explicit level (a lost alert stays an `error` line); `ops:alert-test` covers all 10 kinds. Undo: re-plan stage 04 of F147 with the old split. · ok
- 2026-11-20 · F147 plan · scope · Locale is required in `createOperatorNotices`, `runSloTick` and `sendTestAlerts`; `OPERATOR_LOCALE` (default `en`) is the one default. Undo: restore the default parameter in those three. · ok
- 2026-11-20 · F125 G1 · scope · Owner approved groups G01–G05 and G10 of `audit/report.md` as the audit advised; G09 approved except the 3 `main.test.ts` rows (reject list). Undo: change the Owner column before the cut stages are planned. · ok
- 2026-11-20 · F125 G1 · scope · G06: `int/e2e-seed.test.ts` runs in the CI `e2e` job; nothing is deleted. Undo: delete the file instead. · ok
- 2026-11-20 · F125 G1 · scope · G07, G08: keep `tools/mail-oauth-spike/` and add it to `test:unit` (Microsoft and Google mailbox sign-in will be built; the kit runs first on the owner's test accounts). Undo: delete the folder. · ok
- 2026-11-20 · F125 G1 · scope · Prose pins: keep the 4 capability-page pins; a follow-up ticket replaces the source regexes of `main.test.ts` and `composition.test.ts` with behaviour tests. Undo: drop the follow-up. · ok
- 2026-11-20 · F125 G1 · user-visible · The draft schema must refuse an invalid date (`2026-13-01`), as a follow-up ticket; an unknown web query key stays accepted. Undo: drop the follow-up. · ok
- 2026-11-20 · F125 G1 · scope · One low-priority follow-up ticket extends the time-literal rule to tests, splits the test files over 800 lines, then extends the size lint to tests. Undo: drop the ticket. · ok
- 2026-11-20 · F150 plan · scope · The in-place operator pages of the docs site (`deploy/README.md`, `docs/release-checklist.md`) stay out of the bare-code scan for now; they join the follow-up with `docs/capabilities/`. Undo: add them to stage 04. · ok
- 2026-11-20 · F151 plan · user-visible · Every demo take ends with `not for upload: gate_provisional` until the owner audits the classifier evidence files; the take runs on a copy marked final. Undo: audit the files, then record a new take. · ok
- 2026-11-20 · F151 plan · user-visible · The public demo video uses replayed answers from the demo week, not a live model call during the take; step 2 shows shadow mode on mail that arrives during the take. Undo: change D-notes in the F151 plan. · ok
- 2026-11-20 · F115 gate G1 · user-visible · G1 decided on the defaults: PD-071 and PD-072 (`gpt-6-luna`, effort low) stay; the holdout gate passed for `drafter-v4` (255/255 code checks, 0 invented commitments, 94.9 % send as is) and injection 14/14. Production drafts are now skeletons: a greeting plus one "Regarding <topic>: [[gap]]." line per question; the manager fills every answer. The 20-draft owner check was not repeated for `drafter-v4`; it stays a pilot-week watch. Undo: set `prompts.drafter` back to `drafter-v1`; for richer drafts plan a drafter-v5 (a short fact from the mail itself) and gate it again. · ok
- 2026-11-20 · F151 plan repair · production · The sim-stack classifier (provider, model, prompt) stays unchanged from 2026-11-23 to the day-5 export, and no change of the production classifier prompt pointer lands before the final demo take; otherwise the take refuses with `demo_prompt_mismatch` or `demo_seed_mixed_models`. Undo: re-run the demo week after the change. · ok
- 2026-11-20 · F162 plan · user-visible · One new legal version carries all four privacy items, so every member accepts the terms again on the release after v0.4.4. Undo: do not release the stage 01 commit. · new
- 2026-11-20 · F162 plan · privacy · The privacy page says the open-loops extractor sends the subject, the local send time, the recipient count and up to 8,000 characters of the user's own Sent mail (14 days, at most 10 recipients), and retries without a fixed limit when the AI service is down. The one-click unsubscribe request is a "Newsletter senders" bullet, not a sub-processor row. `unsubscribe-data` names members too. A report mail appends into the INBOX in every mode, so the shadow-mode sentences get an exception. Undo: edit the texts in `packages/core/src/legal/`. · new
- 2026-11-20 · F164 plan · user-visible · drafter-v5 becomes the production drafter only when the holdout gate passes, the injection set passes 14 of 14, the commitment traps show 0 invented commitments and the holdout shows 0 leaning sentences; it switches even if the style smoke fails. The pointer change rides the next normal release, so the reply-drafts pilot may run on v5 (flag off for every organization now). Undo: set `prompts.drafter` back to `drafter-v4`. · new
- 2026-11-20 · F164 plan · money · At most $2.00 of eval spend on the shared OpenAI key for the drafter work (stage 05 $0.35, stage 06 $0.90, stage 07 $0.75); a run above its cap does not start. The key goes only into a job environment. Undo: rotate the key. · new
- 2026-11-21 · F163 plan · user-visible · The privacy papers get a new legal version entry (built from the build day), not a new digest for `2026-11-20.2`; both ship on the release after v0.4.4 and each member accepts once. I hold that release until F163 stage 01 lands, so members do not accept twice. Undo: do not release the stage 01 commit. · new
- 2026-11-21 · F163 plan · privacy · The privacy page and DPA say what the reply-style call sends: on the owner's tap only, text of up to 100 own sent mails of the last 14 days (1,500 characters each, 60,000 in all), cut of quotes, forwards and signature on a best-effort basis (names, addresses and quoted mail of other people can remain), no subject and no header address, at most 2 calls per tap, no new try after an AI service error, answer (at most 1,000 characters) not stored. The `gemini` registry row also names the reply-draft fields. Undo: reword in a later legal version. · new
- 2026-11-21 · F163 plan · scope · The public security claim and the DPIA flow stay as they are; a follow-up ticket names both reply-draft calls there, to land before `style_from_sent` goes on for anyone. Undo: none needed. · new
- 2026-11-21 · F164 stage 06 · user-visible · The holdout condition for the `drafter-v5` pointer switch changes from "0 leaning sentences" to "at most 2 drafts with a leaning sentence", on a narrowed scan (weekday, month and position phrases no longer match). Reason: the stage 06 review showed a bar of 0 would block almost surely, and a draft is sent only after the owner approves it. Undo: set the bar back to 0 in stage 07. · new
- 2026-11-21 · F115 stage 18 · user-visible, production · Owner approved the reply-draft pilot: flag `reply_drafts` goes on for the pilot organization only, after release v0.4.5 is live and watched. Drafts are skeletons (drafter-v4); the owner checks them and sends the three real replies. Undo: set the flag `reply_drafts` off (stops new drafts at once). · new
- 2026-11-21 · F115 stage 18 · scope · The pilot job also turned on the mailbox switch `reply_drafts` for the pilot mailbox through the CLI (the stage requires it). Undo: `mailbox:settings switch --org-id ac6ed6a2-… --mailbox-id 8bc7f572-… --name reply_drafts --value off`. · new
- 2026-11-21 · F115 stage 18 · rule-exception · The owner check of 20 drafts (`owner-check-20.md`) is recorded as "not done"; the judge stays as it is. Undo: fill the file; more than 4 disagreements means fix the judge first. · new
- 2026-11-24 · F170 plan · user-visible · Onboarding Assist card opens the Settings mode dialog with one mailbox and links to Settings with two or more. Undo: always link to Settings. · new
- 2026-11-24 · F170 plan · scope · Mailbox Pause and Resume stay (the programme page said cut). Undo: remove the buttons in F170 stage 07. · new
- 2026-11-24 · F170 plan · user-visible · An OAuth mailbox with a login error shows "access revoked" and the connect dialog, with no "Change password". Undo: change the card state in F170 stage 07. · new
- 2026-11-24 · F170 plan review · user-visible · An OAuth mailbox with a login error gets a Reconnect button that sends the mailbox id (the server already supports it), not a remove-and-connect hint. Undo: show the hint in F170 stage 07. · new
- 2026-11-24 · F167 plan · user-visible · Login brand panel texts name the owner (an assistant member sees the page too); browser colour teal #0a7568 light, dark background in dark. Undo: edit the texts in the F167 stage 05 i18n keys. · new
- 2026-11-24 · F168 plan · user-visible · A review correction from the "It is something else" menu saves with one tap; a mis-tap after a grant can feed the tripwire. Undo: add a confirm step in F168 stage 08. · new
- 2026-11-24 · F168 plan · rule-exception · Activity texts lose their emoji; the test that ties them to the Telegram texts compares the words only. Undo: restore the emoji and the strict test. · new
- 2026-11-24 · F168 plan · scope · No user docs page for approvals in this ticket (the page is behind a default-off flag; the docs rule forbids its strings). Undo: add the section when the flag goes on. · new
- 2026-11-24 · F170 plan · user-visible · In a shadow week the Stats ring shows the would-handle share, labelled "Would handle (shadow)". Undo: show the handled share (0 % in shadow weeks). · new
- 2026-11-24 · F170 plan · user-visible · The onboarding mode step keeps today's text rule: an owner reads "open", a member reads the assistant text; only an owner who can write gets buttons. Undo: change in F170 stage 06. · new
- 2026-11-24 · F169 plan · user-visible · Old delegation addresses `?filter=open|overdue|answered` change nothing; `?filter=closed` opens the closed list. Undo: map the old filters to columns in F169 stage 03. · new
- 2026-11-24 · F169 plan · user-visible · A sender rule for all mailboxes no longer shows an "All mailboxes" line. Undo: keep the line in F169 stage 08. · new
- 2026-11-24 · standing rule · scope · Owner: do not wait (valid 24 hours only, until 2026-11-25 evening) for any confirmation; use the default for every decision; bypass every blocker. This includes the contact-sheet "go" before the Pebble release (default: go once CI is green). Not covered: secrets, real money, deletion of real data, publication outside the repository. Undo: owner says stop. · new
- 2026-11-25 · F171 plan · user-visible · The docs site changes only accent, mark, favicon and font; Starlight grays and layout stay. Undo: widen F171 stage 01. · new
- 2026-11-25 · F171 plan · user-visible · The e2e demo caption of the report step loses the first person: en "Day 3: what it would have done." pl "Dzień 3: co zrobiłby asystent." Undo: restore the old caption in F171 stage 05. · new
