# F118 stage 09 — minimal Telegram render: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 09). No migration. `TERMS_VERSION` NOT bumped (stage 13 does it). `web_push` stays OFF; nothing is deployed. Nothing selects `minimal` yet: the sender still renders `full` (stage 10 chooses the level at send time and passes `webBaseUrl`).

## What was built
- `noticeDetails` = `full`, `minimal`. `NoticeRenderOptions.webBaseUrl?`. `NoticeRenderer.telegram.minimal` is required by the type (removing one fails `tsc`, mutation m14). `renderNotice` finds the renderer by channel and detail; mail and push have no `minimal` (`{ ok: false }`).
- `notices/minimal.ts`: `minimalOf(kind)` (one phrase with the count, then the link line of `noticePath`), digest, weekly and loop-consent renderers, `minimalDigestMessage`, `minimalReviewMessage`, `panelLinkOf` (no double slash). `texts/minimal.ts`: the phrases (push kinds reuse the push bodies with an emoji; five kinds have an own phrase).
- Digest: `DigestMinimalFacts` (`digest/digest.ts`, from `renderDigestWithBrief`, returned as `RenderedDigest.minimal` and `DigestBuilt.minimal`), the optional view field `digest.minimal` (written into the Telegram row only by `queueDigest`). A digest row without the field prints "Your digest is ready" and the link. Rollback hazard: the code before this stage refuses the new key (strict view); drain pending digest rows first (written in `docs/capabilities/digest-and-notices.md` rule 3d).
- Direct answers: `telegramDetailOf(deps, link)` (`channels/commands.ts`) returns `full` until stage 10; `CommandDeps.detailOf` is the test seam (fake level). `/digest` (minimal digest, no keyboard), `/review` (panel line after the flag check), `/status` ("Mailbox 1…", also in the approvals lines).
- Tests: `packages/core/src/notices/minimal.test.ts` (canary over all 23 kinds, en and pl, with and without a base URL; digest facts; links; plural forms; phrase table), `apps/server/test/integration/channels-minimal-detail.test.ts`. The full renders are unchanged: the existing `renderNotice > $kind renders byte-identical to its render function` test in `registry.test.ts` covers test 2 of the stage file.

## Decisions to confirm (not fixed by the stage file)
1. `approval_edit` minimal (renderer and `renderNoticeEdit`) has NO button: D12 says no button for any kind. A held send keeps its Reject button at the `full` level only.
2. `loop_consent` minimal prints its fixed line (chosen by `about`) plus the link; the view's `panelUrl` is not printed. `reply_prompt` minimal = full (a fixed question with ForceReply, no view string).
3. `/pause` and `/resume` answers still name the mailbox addresses (the stage lists `/digest`, `/review`, `/status` only). OPEN QUESTION for the owner: should they use "Mailbox n" at the minimal level too? A follow-up in stage 10 or 11 can add it with `telegramDetailOf`.
4. The weekly report minimal prints two numbers of the view (`week.m4.triaged`, `week.m4.handled`) and no label string.
5. `/digest` at the minimal level still builds the full digest (reads mail rows in memory) to get the counts; the text holds none of it.

## For stage 10
- `telegramDetailOf` is the single place to make real (`detailsOf(trx, ctx, userIds)` batch reader for the sender). The sender must pass `detail` and `webBaseUrl` to `renderNotice`; `queueNotice` still check-renders `full` only.
- Taps on old `full` cards answer as today (D12).

## Proof logs
Under `.f118s09-logs/` in the job worktree (untracked): `mutation-m*.log` (one per guard; each shows the failing test or the type error and the restore), `proof-*.log`, `proof-result.txt`.
