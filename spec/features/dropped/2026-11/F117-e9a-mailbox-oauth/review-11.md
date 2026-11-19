# F117 stage 11 review (Opus 5.5, PASS 79aed2c4)

Model: Opus 5.5, because the stage has new Polish text and a message to people (auth_error notice) and touches mailbox auth. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (an OAuth mailbox in `auth_error` with `auth_reason` null had no test for /pause, /resume, /status; mutant r2 survived), the merge conflict (`channels-notices.test.ts`, `digest-and-notices.md`: keep both sides), the wording of `admin_consent_required` (en "This app needs approval at {p}…", pl "w usłudze {p}"), and `AUTH_REASONS` in `mailboxes.ts` now uses the core `authErrorReasons`.

Verified: view fields hold no token; password paths refuse an OAuth mailbox before any login or write (409 `oauth_mailbox`, a second org gives 404, the CLI exits 1 and echoes no password); notice dedup `auth_error:<id>:<status_changed_at>`; old rows parse; four fixOAuth cases match the plan table; 14 worker mutations killed.

Notes for stages 17/18/19:
- The `admin_consent_required` text says "tap Reconnect" and "use the approval link": both exist only after stages 17 and 18. No person can create an OAuth mailbox before the connect UI (flags off), so no one sees a false text. Keep stages 17 and 18 before any flag turns on. The approval link is Microsoft only; for Google (`consent_required`) only Reconnect remains true.
- `approvedAuthError` tap answer (`texts/bot.ts`) still says "until the password is fixed": give it an OAuth form in stage 18 or 19.
- The panel "Change password" on an OAuth mailbox gets 409 and shows `error_generic` (no `oauth_mailbox` text in `apps/web/src/lib/errors.ts`): stage 18 removes the button and adds the text.
- Inside one `auth_error` episode a reason change makes no new notice row (the plan rule); a pending row keeps the old reason's text. No test pins the single-row behaviour.
