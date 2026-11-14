# F117 stage 15 — Gmail: folders, virtual labels and the spike facts

Part of [`../plan.md`](../plan.md). Needs stage 02 and gate G1 (row G2 PASS), and stage 10. Read `spike.md` first: its "Plan changes" list may name this stage.

## Step 15.1 — Gmail folder rules

**Goal.** A Gmail mailbox (OAuth or app password) maps its folders right and never syncs a virtual label that holds copies of other mail (PD-087).

**Rules.**
- Folder map: `[Gmail]/Drafts` (`\Drafts`), `[Gmail]/Sent Mail` (`\Sent`), `[Gmail]/Trash` (`\Trash`), `[Gmail]/Spam` (`\Junk`) through the special-use flags, as today. Folders with `\All`, `\Important` or `\Flagged` never enter the map.
- Sync folders: the sync-folder setting refuses a folder with `\All`, `\Important` or `\Flagged` (all providers) with `400 virtual_folder`; the folder list of the settings page marks them as not selectable. A virtual folder holds copies of mail in other folders; syncing it would store each mail twice.
- `AI/*` folders are Gmail labels. A `UID MOVE` from INBOX removes the INBOX label (spike G3 [PASS]); the copy logic of sync needs no change.
- The web error text for `virtual_folder` (en, pl): "This folder only shows mail from other folders, so it cannot be synced." / "Ten folder pokazuje tylko wiadomości z innych folderów, więc nie można go synchronizować."

## Step 15.2 — Spike facts for Gmail

From `spike.md` (defaults in brackets):
- **Sent (G5).** Gmail SMTP saves one copy in `[Gmail]/Sent Mail` with the same Message-ID [PASS]. The committer's "locate first, APPEND only if missing" then finds it. If G5 shows a second copy or a new Message-ID, stop and report: the committer rule changes, and that is a question.
- **Drafts (G4).** `UID EXPUNGE` in `[Gmail]/Drafts` removes the draft [PASS]. If it only moves it to Trash, write it in the final message (the draft-replace path keeps working; Trash fills).
- **Refresh (G6).** No rotation [Google default]; `invalid_grant` after a revoke maps to `oauth_expired` (Q10).
- **Testing mode.** The refresh token ends after 7 days (R6): the first weekly `invalid_grant` is `oauth_expired`; the notice of stage 11 says "Reconnect".
- **App password (G7).** If it passed, the `gmail` preset stays as it is; if it failed, say so in the final message (help text change in stage 18).

**Decisions.** D5, D17, Q10.

**Test.**
1. Unit: `buildFolderMap` with the Gmail list (`INBOX`, `[Gmail]/All Mail` `\All`, `[Gmail]/Drafts` `\Drafts`, `[Gmail]/Important` `\Important`, `[Gmail]/Sent Mail` `\Sent`, `[Gmail]/Spam` `\Junk`, `[Gmail]/Starred` `\Flagged`, `[Gmail]/Trash` `\Trash`) → Drafts, Sent, Junk, Trash as named; no `\All`, `\Important` or `\Flagged` path in the map.
2. Integration: the sync-folder route with `[Gmail]/All Mail` → `400 virtual_folder`, nothing stored; with a normal label → as today.
3. Integration: the settings folder list marks `[Gmail]/All Mail` not selectable (the view field the panel reads).
4. Integration (GreenMail, fake token server): a Google OAuth mailbox runs one sync and one approved delegation over XOAUTH2 SMTP; the committer finds no Sent copy on GreenMail (it does not save Sent) and APPENDs one, as for other hosts.
5. Unit (web i18n): the `virtual_folder` text in en and pl.

**Check.** The Proof, with `&& bun run web:build > /tmp/f117-s15/web.log 2>&1` before `echo` (a web text changes).

**Done when.** The tests pass; `spike.md`'s plan-change lines for this stage are done or answered; the Proof prints `PROOF_OK`.

**Out of scope.** A Gmail API adapter; Gmail threads or labels as product features.
