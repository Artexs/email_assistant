# Changelog

All notable changes to the email assistant. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow SemVer in the `0.y.z` range. `bun run release:prepare <x.y.z>` moves the items under `[Unreleased]` to a new version heading (`docs/release-checklist.md`). Items are in product words.

<!--
The group "For users" is optional. It holds what a user of the web panel can see. The changelog page of the docs site
shows only this group, per release. Every other group is operator text and stays private.
One item is two lines: the English text, then the Polish text indented by two spaces. Example (indented, not a real heading):

    ### For users

    - en: Short sentence about what changed for the user.
      pl: Krótkie zdanie o tym, co zmieniło się dla użytkownika.

A heading is "## [x.y.z] - YYYY-MM-DD" (plain SemVer, newest first). "bun run release:prepare" keeps the group.
-->

## [Unreleased]

## [0.4.3] - 2026-11-20

### Changed

- Production env: the server and `cli` get no database password and no migrator URL from Compose. Only the one-off `migrate` service gets the migrator key. `deploy/release.sh` runs `deploy/check-server-env.sh` in its verify step. `deploy/release.sh`, `deploy/rollback.sh` and `deploy/restore.sh --target new-host` refuse a host whose env is not split.
- Legal pages: terms version `2026-11-20` (the AI provider section names the thread context and the history check). Every member accepts the terms again at the next sign-in.
- Reply drafter: the prompt `drafter-v4` passed its holdout gate and is now the production prompt. `reply_drafts` stays off.
- Command-line tools follow one exit code rule: 0 done, 1 failed, 2 bad arguments, 3 an outside system (the database, Telegram) does not answer, 4 incomplete. `org:break-glass` and `web:two-factor-reset` need `--confirm` with the organization name.
- The data export names the two mail columns `source_uid` and `move_pending_at`; the old names `inbox_uid` and `undo_pending_at` stay in the database as copies for one release.

## [0.4.2] - 2026-11-20

### Added

- LLM provider: one variable `LLM_PROVIDER` (`openai`, `gemini` or `deepseek`) and the key of that provider decide the model of every role (light tier: classifier, drafter, extractor; strong tier: judge). DeepSeek is for dev, tests and evals only. `bun run llm:check --role all [--provider <id>]` checks the four roles; the eval flags `--provider` and `--judge-provider` pin one run.

### Removed

- The per-role model, provider and effort keys of the LLM roles. An old `.env` with one of them stops the start and the log names the key (`reason=key_removed`). Delete these keys before the deploy: `deploy/README.md` § LLM provider tiers.

## [0.4.1] - 2026-11-19

### Fixed

- Capability page format: the checked line of the backups and operations pages stands alone on its line again.

## [0.4.0] - 2026-11-19

### Added

- Data requests: `bun run org:dsr --org-id <uuid> --rule-check` lists each letter that the database lower-cases unlike the program (on `postgres:17`: 28 rare letters). It prints no address.

### Changed

- Act from the panel: the Approvals page and the Delegates and Delegations pages (flags `approvals_page`, `delegation_pages`) are turned on for the pilot organization after this deploy. There you approve, reject and edit waiting drafts and manage delegates. The other organizations keep them off.
- Trust ladder: this deploy checks that every automatic category carries its model-setup stamp, and the operator runs the history check for the pilot mailbox (flag `trust_ladder` on for the pilot organization). The other trust flags (why lines, spam line, quiet hours, report mail, urgency editor, panel review, newsletters) stay off.
- Legal pages and cost: no text change in this release. The draft privacy policy, terms and data processing pages stay at terms version `2026-11-19`. The operator measures the LLM cost of the pilot over the last four weeks (read only) as the basis of the cost model.
- Company sign-in (OIDC): no change for users. The flag `sso_sign_in` stays off and no organization has a provider, so the sign-in page shows no company button.
- Backups: the copy to B2 runs up to 5 times with a growing wait (`BACKUP_RCLONE_TRIES`, `BACKUP_RCLONE_DELAY`), so a short DNS or B2 login failure no longer fails the nightly backup. Only one backup run works at a time: a second run exits with code 75 and leaves the status file as it is.
- The reply drafter prompt `drafter-v1` is tuned on the dev part (no invented promise or request, shorter gap labels). It still has no holdout report, so `reply_drafts` stays off. The reply drafter eval (`bun run eval --drafter`) has a judge gain section.

### Fixed

- Data requests: find and erase now refuse an address with a letter that the database lower-cases unlike the program (`rule_mismatch`). They change nothing and write no audit row, so they no longer give a wrong match for such an address.

## [0.3.1] - 2026-11-19

### For users

- en: The privacy policy now names the browser push services (Google FCM, Mozilla, Apple, Microsoft) and the two Telegram levels, "Counts and links only" and "Full". The terms and the data processing agreement now also mention push devices. You accept the new terms once, at your next sign-in.
  pl: Polityka prywatności wymienia teraz usługi push przeglądarek (Google FCM, Mozilla, Apple, Microsoft) oraz dwa poziomy Telegrama: „Tylko liczby i linki” i „Pełna treść”. Regulamin i umowa powierzenia danych wspominają też o urządzeniach push. Nowy regulamin akceptujesz raz, przy następnym logowaniu.

### Added

- Phone channel, second part (flags `web_push`, `telegram_minimal`): the Settings cards for the Telegram detail level and for routing each notice group to Telegram, push or both; the owner lock for the minimal level; push notices and the minimal Telegram text render for every notice kind. The detail tables and the lock API behind them are in.

### Fixed

- The data request find and erase now match an address in every letter case, also for letters that the database and the program lower-case differently (for example a dotless i or a Greek final sigma), and no longer match another person's address that only looks similar. The erase scrubs the same texts that the find lists.

### Changed

- The terms version moves to `2026-11-19`. The sub-processor registry has the row `web-push` (active when `VAPID_PRIVATE_KEY` is set), and `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` map to it in `OUTSIDE_SERVICE_KEYS`. Each data category that is kept until a delete now has a scope with its own text: "Until the mailbox or the organization is deleted", "Until the member removes it or the organization is deleted" (chat links, push devices) or "Until the organization is deleted" (the account). `tg_consent_text` and the consent version do not change. ADR 0032 is accepted. `deploy/README.md` has the section "Phone notices and Telegram detail (F118)" with the keys, the flags and the rollback steps. The flags `web_push` and `telegram_minimal` stay off until the owner turns them on for the pilot organization.

## [0.3.0] - 2026-11-19

### For users

- en: The privacy policy, terms and data processing pages now also describe sender profiles and phone devices. You accept the new terms once, at your next sign-in.
  pl: Polityka prywatności, regulamin i umowa powierzenia danych opisują teraz także profile nadawców i urządzenia telefonu. Nowy regulamin akceptujesz raz, przy następnym logowaniu.
- en: The tutorial and two how-to guides on the docs site now show screenshots of the panel.
  pl: Poradnik startowy i dwa poradniki na stronie z dokumentacją pokazują teraz zrzuty ekranu panelu.

### Added

- Every new feature below ships OFF. No organization sees it until the operator turns its flag on (`org:flag`, per organization). The new flags are `reply_drafts`, `draft_copy_check`, `bulk_unsubscribe`, `panel_review`, `spam_review_line`, `urgency_editor`, `sender_context`, `sender_suggestions`, `contact_wait`, `web_push` and `telegram_minimal`. The parts of open loops and the trust ladder that came in this release sit behind their existing flags (`open_loops`, `delegate_button`, `trust_ladder`, `report_mail`, `why_lines`, `user_quiet_hours`), also off. Keep `reply_drafts` off in the pilot: while it is on, owners get "Confirm the new Telegram terms in the panel", and no panel text covers reply data yet.
- Reply drafts (flag `reply_drafts`, plus a switch per mailbox): mail that needs a reply gets a checked draft in its thread, in the mailbox style, that waits for one tap. A reply draft lives 7 days and closes when you answer the mail yourself, a newer mail arrives in the thread or the mail moves. Drafts with a missing fact carry a gap and cannot be approved. A draft refuses account numbers that you did not type.
- Reply drafts in Telegram and in the panel: a "replies ready" notice and a one-draft-at-a-time review with Skip, Redraft, Reply all, Use Reply-To and Draft reply on tap; a reply item on the Approvals page and a Draft reply action on Activity rows; a style card (name, signature, writing style) with sample drafts on recent mail; counts of reply outcomes in the weekly report. The drafter prompt `drafter-v1` has no committed holdout report yet.
- Mail-client edit safety for every draft kind (flag `draft_copy_check`; reply drafts always use it): before a send, the system compares the copy in your Drafts folder with the one it made. It stops when you changed the copy, never deletes a changed copy, and never answers a mail twice.
- Open loops in the panel (flags `open_loops`, `delegate_button`; needs `sent_sync`): an Open loops page with the tabs Delegated, Waiting and Promised, the Delegate action on Activity rows, a settings card (days to wait, automatic follow-up), the "needs you today" brief, loop taps in Telegram, the loop commands in the API, and the open-loop counts in the delegation numbers.
- Trust ladder in the panel (flag `trust_ladder`): a history check report page ("what I would have done") with one "Turn on recommended" tap, an autonomy card with the evidence per category, a tripwire that pauses a category after two corrections of applied moves in 7 days, and a re-gate that stops automatic moves granted under an old model or endpoint after a switch, each with one notice. Stats and the weekly report show the evidence rows.
- Check 10 decisions (flag `panel_review`): an optional panel page where you label a sample of the assistant's decisions.
- Digest additions: a line with the mails that went to spam (flag `spam_review_line`), the digest and trust reports as mail in your own INBOX, never triaged (flag `report_mail`), and per-member quiet hours (flag `user_quiet_hours`).
- Urgency editor (flag `urgency_editor`): a "What is urgent for me" card on the Rules page with topics and deadlines per mailbox.
- Newsletters list with one-tap unsubscribe (flag `bulk_unsubscribe`): the senders with their unsubscribe method on the Rules page, and a guarded one-click unsubscribe request for senders that allow it.
- Sender profiles (flag `sender_context`): a count-only profile of each sender per mailbox (mails, answers, corrections, reply times; no mail text, no plain address; deleted 12 months after the last mail). The profile feeds a sender line in Activity and Approvals, known domains from your Sent mail for the look-alike rule (also needs `suspicious_mail`), VIP, whitelist and blocklist suggestions with a reason on the Rules page (flag `sender_suggestions`; Accept and Dismiss; a line in the weekly report), and an open loop that waits as long as its contact usually takes to reply (flag `contact_wait`). The `sender_suggestions` and `contact_wait` flags count as off unless `sender_context` is on.
- Phone channel, first part (flag `web_push`): the panel installs as an app (manifest, service worker, offline page); a device card in Settings to turn on, test and remove push on a device; push notices with only a kind, a count and a link; a member picks per notice group Telegram, push or both (settings API); push-only members get urgent and approval notices. The Settings cards for routing are not in this release. The VAPID keys come from `bun run push:keys` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); with none set, Web Push stays off.
- Telegram detail level (flag `telegram_minimal`): a member on minimal gets counts and panel links, no mail text and no buttons, for every notice kind; the owner can lock minimal for the organization. The routes and the stored level are in; the Settings cards for the level and for routing notices per group are not in this release.
- Account data covers the new data: retention, data request find and erase, export and organization delete handle sender profiles, reply texts and mailbox profiles, unsubscribe requests and push devices (the secret of a device is never exported).
- Operator tools: `bun run push:keys` (makes the VAPID pair; writes nothing), `bun run reply:check-copy` (probe of the Drafts copy check), `bun run mailbox:profile` (shows and sets the reply profile of a mailbox), `bun run docs:shots` (screenshots for the docs site); the operator mailbox tools open mailboxes that sign in with Microsoft or Google; `TEST_MAILBOX_ADDRESS` accepts one address or a comma-separated list.
- An install guide for an own-model server for the LLM calls (privacy claims rest on published holdout numbers).
- Legal papers (drafts, not legal advice): records of processing, a DPIA draft, a breach procedure and a claims list with a source for each claim.

### Changed

- The terms version moves to `2026-11-18-2`: every member accepts the terms once at the next sign-in. The legal pages and the data-category list now name sender profiles, reply texts and push devices.
- The `docs-deploy` workflow runs every CI job first, then makes the screenshots from the e2e seed (no real data), builds the site and checks it in a browser. A deploy stops at a red job.
- The Telegram text for a missing draft now says "the draft is not in your Drafts folder" (it also covers a deleted copy).
- A new `CREDENTIALS_KEY` also drops every stored push device: the stored secret of a device does not open, and the push sender removes the device at the next send.
- Seven database migrations run at the deploy (all expand only; the schema works with the code of v0.2.0): `20261117120001_history_model_failing` (came in 0.2.1), `20261117130001_reply_drafts`, `20261117140001_unsubscribe_data`, `20261118120001_sender_context`, `20261118130001_push_devices`, `20261119100001_dkim_signatures`, `20261119130001_telegram_detail`. Two marks name a release: `history_model_failing` names v0.1.0 (deployed), `push_devices` names v0.2.1, which was never deployed; both only silence the check for a list that grows and a new constraint, and nothing is dropped. One rollback rule: with `contact_wait` on, a rollback of the code first runs `UPDATE open_loops SET due_source = 'default', usual_reply_days = NULL WHERE due_source = 'contact'` (the flag is off, so no such row exists at the deploy). `telegram_detail` sets every member with a Telegram link to `full`; a new link defaults to `minimal` once `telegram_minimal` is on.

### Fixed

- A data request erase now finds the mail of a sender whose address has a whitespace or case form that the text match missed (a Greek final sigma, a Turkish dotted capital I); find and erase use one address rule.

### Removed

- The escalation cascade (a second model call that never shipped): its code, the role and the keys `LLM_ESCALATION_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM` and `_REASONING`, and the `--escalate` options of the eval tool. An old `.env` that still holds the keys starts fine; the keys change nothing.

### Security

- One-click unsubscribe (flag `bulk_unsubscribe`) counts a sender as one-click only when a DKIM signature that the receiving server verified covers the `List-Unsubscribe` and `List-Unsubscribe-Post` headers, so a replayed signed mail with forged header lines cannot aim the request at another host. A mail stored before the migration has no signature record: its sender is link-only until a newer mail arrives.
- Push notices hold only a kind, a count and an id; the endpoint and the keys of a device are stored in the secret box and bound to one web session, and a sign-out removes that session's devices.

## [0.2.1] - 2026-11-17

### For users

- en: Draft privacy policy, terms and data processing pages in English and Polish, linked from the sign-in page and the Account card.
  pl: Robocze wersje polityki prywatności, regulaminu i umowy powierzenia danych po angielsku i po polsku, z linkami na stronie logowania i w karcie Konto.
- en: The docs site has Polish pages for the start guide, the how-to guides and the FAQ.
  pl: Strona z dokumentacją ma polskie strony: przewodnik startowy, poradniki i FAQ.

### Added

- Open loops (Waiting and Promised mail, follow-up drafts, Telegram buttons, the M2 split by kind), the trust ladder (history check, re-gate, tripwire, why lines, quiet hours, urgency editor), the reply-draft safety check and the report mail queue. All sit behind flags that stay off.
- Registries of outside services and of stored data categories, with tests that fail when a table or an outside key has no entry.

### Changed

- One read of the Sent folder stops after 60 seconds, so a slow Sent folder cannot delay the inbox sync. The `sent_sync_done` log line has `duration_ms` and a `budget` status.

## [0.2.0] - 2026-11-15

### For users

- en: A public docs site with guides and this list of changes.
  pl: Publiczna strona z dokumentacją: poradniki i ta lista zmian.

## [0.1.0] - 2026-11-15

### Added

- Offline quality lab: one command measures per-category precision and recall of the classifier on a frozen set of made-up mails.
- Weekly report: every Monday the executive gets one Telegram message with the week's numbers, and the panel shows 8 weeks of them.
- Polish and English in the web panel, the Telegram bot and the auth mails, by the language of each user.
- Send limits per mailbox, an operator console and a security log in the Account card.
- Two-factor sign-in with an authenticator app and backup codes, a trusted device for 30 days, and one break-glass owner per organization.
- Company sign-in (OIDC) for organizations with their own identity provider, and an "SSO required" rule.
- Account data: an owner deletes the organization with all its data, and the operator exports it and answers a data request.
- Act from the panel: approve, reject and edit waiting drafts, and manage delegates and delegations, with a typed API behind every action.
- Read the Sent folder of a mailbox (off until the owner turns it on): the assistant knows what the executive sent.
- Sign in with Microsoft or Google to connect a mailbox (first stages).
- Operator alerts: one Telegram text when sync, urgent notices or the LLM break their service level, a repeat every 6 hours and one "resolved" text.
- Structured event logs with a search store on the tailnet, kept 30 days.
- Warning for suspicious mail, attachments in the notice, and a "not triaged yet" notice during an LLM pause.

### Changed

- The web panel runs on Astro 7.
- Each classifier change ships only when it wins on the dev set and holds on the holdout.
- Docker rotates the log of each service: at most 5 files of 10 MB.

### Fixed

- A copy of a mail below the sync position is stored.
- Turning two-factor sign-in off, or making new backup codes, needs a code from the authenticator app.
