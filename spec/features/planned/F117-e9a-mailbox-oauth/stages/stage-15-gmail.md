# F117 stage 15 — Gmail: folders, virtual labels and the spike facts

Part of [`../plan.md`](../plan.md). Needs stage 02 and gate G1 (row G2 PASS), and stage 10. Read `spike.md` first: its "Plan changes" list may name this stage.

## Step 15.1 — Gmail folder rules

**Goal.** A Gmail mailbox (OAuth or app password) maps its folders right and never syncs a virtual label that holds copies of other mail (PD-087).

**Rules.**
- Folder map: `[Gmail]/Drafts` (`\Drafts`), `[Gmail]/Sent Mail` (`\Sent`), `[Gmail]/Trash` (`\Trash`), `[Gmail]/Spam` (`\Junk`) through the special-use flags, as today. Folders with `\All`, `\Important` or `\Flagged` never enter the map.
- Sync folders come only from the fixed default names (`docs/capabilities/sync.md` rule 5), so no Gmail virtual folder can become a sync folder today. Keep it so: the code that adds the default sync-folder rows skips a folder with `\All`, `\Important` or `\Flagged`, even when its name matches a default. A virtual folder would store each mail twice. No route or web text changes (the review of the plan found no path-taking route).
- `AI/*` folders are Gmail labels. A `UID MOVE` from INBOX removes the INBOX label (spike G3 [PASS]); the copy logic of sync needs no change.

## Step 15.2 — Spike facts for Gmail

From `spike.md` (defaults in brackets):
- **Sent (G5).** Gmail SMTP saves one copy in `[Gmail]/Sent Mail` with the same Message-ID [PASS]. The committer's "locate first, APPEND only if missing" then finds it. If G5 shows a second copy or a new Message-ID, stop and report: the committer rule changes, and that is a question.
- **Drafts (G4).** `UID EXPUNGE` in `[Gmail]/Drafts` removes the draft [PASS]. If it only moves it to Trash, write it in the final message (the draft-replace path keeps working; Trash fills).
- **Refresh (G6).** No rotation [Google default]; `invalid_grant` after a revoke maps to `oauth_expired` (Q10).
- **Testing mode.** The refresh token ends after 7 days (R6): the first weekly `invalid_grant` is `oauth_expired`; the notice of stage 11 says "Reconnect".
- **App password (G7).** If it passed, the `gmail` preset stays; if it failed, change its help text (en, pl) in this stage and give both texts in the final message for review.

**Decisions.** D5, D17, Q10.

**Test.**
1. Unit: `buildFolderMap` with the Gmail list (`INBOX`, `[Gmail]/All Mail` `\All`, `[Gmail]/Drafts` `\Drafts`, `[Gmail]/Important` `\Important`, `[Gmail]/Sent Mail` `\Sent`, `[Gmail]/Spam` `\Junk`, `[Gmail]/Starred` `\Flagged`, `[Gmail]/Trash` `\Trash`) → Drafts, Sent, Junk, Trash as named; no `\All`, `\Important` or `\Flagged` path in the map.
2. Unit or integration: the default sync-folder adder, given a folder named like a default with `\All`, adds no row; a normal default folder → as today.
3. Integration (GreenMail, fake token server): a Google OAuth mailbox runs one sync and one approved delegation over XOAUTH2 SMTP; the committer finds no Sent copy on GreenMail (it does not save Sent) and APPENDs one, as for other hosts.

**Check.** The Proof (add `web:build` only if the G7 help text changed).

**Done when.** The tests pass; `spike.md`'s plan-change lines for this stage are done or answered; the Proof prints `PROOF_OK`.

**Out of scope.** A Gmail API adapter; Gmail threads or labels as product features.
