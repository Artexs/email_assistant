# F104 stage 10 review notes (Opus review of fde1fb54: PASS with test gaps)

Source: `.limen/jobs/2026-11-15-f104-review-s10-opus-sent-switch-422e67bb/result`, mutation files in `/tmp/f104-s10-review/`, follow-up logs in `/tmp/f104-s10-fu/`.

## Test gaps (closed in the follow-up commit)

- TG1: no test ran the card's PATCH. The write now lives in `apps/web/src/lib/sent-switch.ts` (`changeSentSync`); `sent-switch.test.ts` checks route `/sent-sync`, body `{ enabled }` (true and false), the toast keys, the 404 → `onMissing` path, and the 403 `owner_only` and `bad_origin` toasts. The reviewer mutations body and route fail it (`/tmp/f104-s10-fu/mut-body.log`, `mut-route.log`); so do the toast swap, the dropped `onMissing` and the dropped error toast.
- TG2: the `MailboxesPage` prop is checked from the source (`sent-switch.test.ts`; the island needs a live session). `sentSyncLine={true}` fails it (`/tmp/f104-s10-fu/mut-connectprop.log`).

## Notes

- N1: `sent_line` said the assistant "never changes" Sent, but its own send can APPEND a copy there. Text changed in en and pl: it reads Sent and does not change or delete the user's mail there.
- N2: the consent texts have no retention line (30 days of headers, 14 of text, 90 days). Owner choice; no consent version while the data goes to no LLM or Telegram (`sent-mail.md` rule 13).
- N3: Polish edits taken: `sent_failed` "nie powiódł się", `sent_paused` "to usunie".
- N4: the status line matches the server data for every branch. A user who sends only through the assistant sees "no sent mail" (system sends do not count).
- N5: the flag can go off between load and click; the PATCH gives 404, the toast and a mailbox list reload, the card stays stale until the next load. Same as `SyncFoldersCard` (D12).
- N6: while paused, `sent_line` still shows; the "paused" status line makes the state clear.
- N7: the N5 rule of review 8 holds: `sent_sync` default is still off, no flag change in the diff.
- N8: docs fixed: `web-panel.md` rule 9 lists the card; `sent-mail.md` rule 16 no longer names the never-rendered case (flag off and switch off: the view is `null`). The code still disables the switch for it (a guard, no test needed beyond the existing one).
- N9: the land merges master by hand in `docs/capabilities/web-panel.md` (F119 stage 14 edited paragraph 1 and rules 8–9): both sides kept.
