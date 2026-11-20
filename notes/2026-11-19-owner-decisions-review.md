# Owner decisions review, 2026-11-19

Check of `docs/owner-decisions.md`: 115 entries. 93 have the status `new`, 21 have `ok` and 1 has `changed`.
For each `new` entry, I compared the claim with the code, the feature lanes, `notes/2026-11-19-coordinator-handoff.md` and `notes/owner-later.md`.
I made no changes to the log. Only the coordinator writes it.
I did not log in to the VPS. The live flag state comes from the handoff note (VPS release v0.4.1).

## A. Open and important: the owner must decide

1. **Conflict: the history check is on, but the privacy text does not describe it.**
   - The entry of 2026-11-18 (F110) says that `trust_ladder` must stay off until the privacy text is fixed.
   - The handoff note lists `trust_ladder` as on for the pilot org on v0.4.1.
   - `apps/web/src/legal/en/privacy.md:46` still says "It does not send mail older than 7 days". It has no sentence about the 30-day history sample, and no sentence about the one-click unsubscribe request.
   - The latest terms version (`2026-11-19-2`, for reply drafts) did not add these sentences.
   - Who is affected: only the owner's own pilot org. Fix: turn the flag off, or add the text and bump `TERMS_VERSION` (both cost about one stage).
2. **Reply drafts (F115) quality gate.**
   - `drafter-v2` failed the holdout: 5 invented commitments, and the bar is 0.
   - Job `…b4ea3556` writes `drafter-v3` and runs one blind re-gate. It is running now.
   - Open owner items:
     - The 20-draft check `spec/features/active/F115-e6a-reply-drafts/owner-check-20.md`. If you do not answer, the plan default is "not done".
     - Your answer to the coordinator's question: if v3 misses the bar by a few, can the pilot run on v2? Each draft needs your Send tap.
3. **Legal pages still have placeholders.**
   - The pages have `<provider name>`, `<address>`, `<contact>`, `<backup retention>` and `<organization name>` (F107 default).
   - This is acceptable while you are the only user. Fill them before any outside user, then bump the terms version.
4. **Backup alerts: U2 is open.**
   - Owner step U2 (the Healthchecks.io URL for the backup ping) is not done. The in-app backup-age alert covers the gap.
   - Operator alerts go to your own bot chat (owner step U3 done by the coordinator).
5. **Live lab money.**
   - The sim stack on the VPS uses the production OpenAI key, with caps of $1 for each day run and $5 for each week run.
   - One lab day run (`day-20261120-215c`, cap $1) stays scheduled.
   - The $5 week run still needs your "go".

## B. Open, low risk: accept unless you object

- **Company sign-in (F119):** the IdP client secret is stored in clear in `sso_providers`, because the plugin has no read hook. It only matters when an org uses company sign-in.
- **Log store (F103):** the log store on the VPS also collects the logs of your other site (`astro-app-container`). These logs can contain visitor IP addresses. The logs stay on the host, bound to 127.0.0.1, for 30 days.
- **Send limit (F109):** the limit of 5 sends per recipient per day holds lab delegation sends.
- **Two-factor sign-in:** it is off by your choice, so the operator console sends you to Settings.
- **Down migrations of F097 and F105:** they delete data. Never run `db:rollback` on the VPS.

## C. Resolved or superseded: you can mark these `ok`

- **Attachment names in Telegram (F109):**
  - The consent gap is closed: a send-side consent gate exists (`apps/server/src/modules/channels/consent.ts`).
  - The flag `attachment_line` is still off.
- **One-click unsubscribe DKIM check (F110):** built by F134 (done).
- **Escalation cascade not shipped (F109):** the code was removed by F130 (done).
- **Password reset for SSO-only members (F119):** superseded. The reset now refuses SSO-only members.
- **Account-number check of reply drafts (F115):** the two entries are superseded by the 12-digit and IBAN rule.
- **F115 stage 02 runs on Gemini (2026-11-19):**
  - Superseded: the runs use OpenAI `gpt-6-luna`.
  - F138 removes Gemini.
- **Mailbox OAuth (F117):** all entries are moot. F117 was dropped.
  - The Entra tenant at $7 a month is no longer needed: F119 stage 16 was skipped.
- **Push checkpoint A (F118):** you closed it. `web_push` stays off in production.
- **Own model (F111):** it runs on LM Studio on your PC. The ticket is closed. The numbers wait in F140 (parked).
- **Classifier v3 (F109) and v4 (F120):** neither was shipped. Production stays on `classifier-v2`.
- **`sent_sync` (F104):** it is on now. You turned on "Track my sent mail" through the coordinator.
- **F110 G1, F116 G1, F119 G1 on defaults, and F105 closed without U1:** done and landed.
- **Terms versions:** six versions exist (`2026-11-17` to `2026-11-19-2`). You accept each one once at sign-in.

## D. History only: no action

- **Rule exceptions:** F097, F100, F104 and F121 were planned or built before their needs closed. All landed or have a refresh.
- **Harness and quota rules:** planners run at thinking medium, Sonnet scouts, sorted review findings, and Opus only for risky stages.
- **Done deploys:** the F099 deploy, release v0.2.0, and the Docs Pages publication (still held: F121 holds deploys until G1).
- **Product defaults (about 45 entries):**
  - Polish texts and the Telegram language.
  - Panel approvals (F102), open loops (F116), re-gate and history check (F110), Telegram levels and push (F118), sender context (F120), and account delete, export and erase (F106).
  - All of them landed behind flags, and each entry names its undo.
- **Process entries of 2026-11-19:** you gave them in chat. They hold as written.
