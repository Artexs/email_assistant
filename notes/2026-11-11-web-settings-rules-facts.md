# S5c web settings and rules: facts and deviations

Source: `tasks/active/s5c-web-settings-rules.md` (facts 1–14, B1–B16, Log). The task file moves to `tasks/done/` at the merge. Built 2026-11-11 in the worktree `task/s5c-web-settings-rules`. Read this note before you change the settings routes, the rules routes, the organization routes, the gate or the e2e setup.

## The gate (fact 4, B2)

- `triage/gate.ts` is the one gate service. `goNoGoFor(db, ctx, mailboxId, now)` runs one query (`listLabeledResults`, real mail) and returns a `GateView` for each of the five bar categories. `setCategoryAutoWithGate` is the one function that the CLI (`mailbox:settings auto`) and the web route call.
- The constants are `GATE_BAR = 0.98` and `GATE_MIN_KEPT = 30`. They live in `packages/core/src/web/settings.ts`. The CLI script does not hold them any more.
- `GateView` = `{ decision, precision, kept, atConfidence, threshold }`. `decision` is `go`, `no-go` or `no-go: too few`.
- `kept` is the number of **rated** mails (feedback ✅ or ✏️) whose model guess is the category, at or above a confidence point. It is not the number of labelled mails. The web texts say "rated mails".
- `threshold` is the point of a `go` row. It is `null` for the other two decisions (`goNoGo` drops the point of a `no-go` row).
- `atConfidence` is the point that the text names. A `go` row: the `threshold`. A `no-go` row: the first sweep point with `kept ≥ 30`. A `no-go: too few` row: the lowest point.
- **`atConfidence` of a `no-go` row is always 0.5.** `kept` never grows when the point rises, so the first point with `kept ≥ 30` is the lowest one. The web text for `no-go` therefore says "at confidence ≥ 0.5". The text is right. A later change that gives `no-go` another point must change `gate.ts`.
- **The `forced` change (B2).** The audit row of `auto on` records `forced: true` only when the gate did not pass and the caller forced. The old CLI recorded `forced: true` also for `--force` on a `go` row. The CLI log lines and the exit code 2 stay.
- The result is a union (`changed` or `refused`), not a thrown error. Reason: `config` cannot import a `triage` error class (`triage` imports `config`).
- The gate reads outside the settings lock. A label that arrives at the same time shows in the next read.
- The route answers 409 `{ error: "no_go", gate }` on `refused`. "Set anyway" repeats the call with `force: true`. A successful `PATCH …/auto/:category` returns the plain settings change, with no `gate`.

## The timezone effects (fact 3, U8)

A change of `organizations.timezone` applies from the next tick:

- The digest job reads the zone for each link on every tick (`channels/digest-job.ts`).
- The sender caches the zone for one run (`channels/sender.ts`). Quiet hours are 22:00–07:00 local.
- The chaser reads the zone for each run (`delegation/chaser.ts`). The reminder gate is 07:30 local.
- A delegation keeps its due instant. The instant is computed once at creation (`DUE_TIME` 17:00 local).

Digest slot keys are local wall-clock strings that the code compares as text. The window is 6 hours. The probe used the times `08:00, 13:00`. Six characterisation tests in `packages/core/src/digest/schedule.test.ts` pin these cases:

1. **West move** (Warsaw → New York), last key `2026-11-11T08:00`. At `13:30Z` (New York 08:30) no slot is due. The key of 08:00 equals the sent key. At `18:00Z` the slot `2026-11-11T13:00` is due.
2. **East move** (Warsaw → Tokyo), last key `2026-11-11T13:00`. At `14:00Z` (Tokyo 23:00) no slot is due. The next slot is `2026-11-12T08:00`.
3. **East move with an earlier last key** `2026-11-11T08:00`. At `08:00Z` (Tokyo 17:00) the slot `2026-11-11T13:00` is due **at once**. It comes one hour after the Warsaw 08:00 digest.
4. **A digest time added after the last digest.** Times `08:00, 11:00`, last key `2026-11-11T08:00`. At `11:00Z` (Warsaw 12:00) the slot `11:00` is due at once, late.
5. **A large west move** (Warsaw → Los Angeles), last key `2026-11-11T13:00`. No slot at `16:00Z` or `21:00Z`. The next slot is `2026-11-12T08:00`. Two digests are skipped.
6. The "later today / tomorrow / no times / late" cases that existed before stay as they were.

On the day of a change, a digest can be skipped, come late or come at once. The Settings page says so (key `tz_note`).

**Open:** the sender and chaser half of this fact has no test. The evidence is the code read above. The review accepted this.

## The signature effect (fact 7, B9)

- The UI calls the text "Signature". The route field is `styleText`. The audit event is `org.style_changed`.
- `buildOutgoingMessage` (`outgoing/message.ts`) puts the signature at the end of every delegation, clarification and reminder message. An empty signature gives the owner's display name. No LLM prompt reads it.
- A change applies to **every message built after it**. This includes the **send of an older draft**: `actions/send.ts` builds the message again at send time with the organization row that the committer loaded for that run. The draft in the mailbox and the Telegram preview keep the old text.
- The help text says "messages the assistant writes from now on". The effect is accepted.
- Limits: 500 characters after normalization (`\r\n` and `\r` become `\n`, then trim). A raw input over 2000 characters is refused first. No control character except `\n` and `\t`. An empty result is stored as `null`.
- The audit row holds `{ set: boolean }` and never the text. The log line holds only the organization id and the actor.

## The server time-zone list (fact 2, B10)

- `GET /api/organization` returns `timezones: Intl.supportedValuesOf("timeZone")` of the running server. `PATCH /api/organization` checks the same list (`isSupportedTimeZone` in `tenancy/service.ts`). `createOrganizationWithOwner` uses the same function.
- Why: the browser's list differs by engine. Bun 1.4.4 (dev) gives 445 names with `UTC` and `Europe/Kyiv` and without `Etc/UTC` and `Europe/Kiev`. Node 26 gives 418 names without `UTC`.
- The image and CI run Bun 1.3.14. **Nobody probed its list.** The tests assert only `Europe/Warsaw` and `Europe/London`. S5e checks one change on the VPS image.
- The page filters the list in the browser (`lib/timezones.ts`, at most 50 results, the current zone first) in a native `<select size={8}>`. The current value shows first even when the list lacks it.

## Better Auth session facts (fact 1, B13)

Better Auth 1.7.18.

- `changePassword` takes `{ newPassword, currentPassword, revokeOtherSessions? }`. The length checks come first (`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, 400). A wrong current password gives 400 `INVALID_PASSWORD`.
- With `revokeOtherSessions: true` it deletes **all** sessions of the user, updates the hash and creates a new session with a new cookie in one transaction. Without it no session changes.
- The S5a hook on `account.update.after` writes `web.password_changed`. The new session writes no `web.login` row (that hook runs only for `/sign-in/email`).
- `POST /revoke-sessions` deletes every session, also the current one. `/revoke-other-sessions` keeps the current one. Both need a valid session.
- `AUTH_ALLOWED_PATHS` holds `/change-password`, `/revoke-other-sessions`, `/revoke-sessions`, `/list-sessions`. The rate rule for `/change-password` is 5 per 60 s.
- The Account card calls Better Auth directly (no wrapper route). "Sign out everywhere" goes to `/login` only when `revokeSessions` succeeded or answered 401 (`signOutAllResult` in `lib/password-errors.ts`). On another error the card shows an inline error, because the login page sends a live session back to the dashboard (stage 9 fix).
- **"Sign out everywhere" writes no audit row.** No `databaseHooks.session.delete` hook exists. The follow-up is in `tasks/planned/web-public-hardening.md`.

## The e2e members (B15)

- The seed (`scripts/e2e-seed.ts`, `e2e-seed-args.ts`) adds one member per project with role `assistant` and a known password: `e2e-member-mobile@x.test` and `e2e-member-desktop@x.test`, password `E2E_MEMBER_PASSWORD`. The seed sets the password in process, as it does for the owner.
- `SeedFile.members` is `Record<E2eProject, { userId, email, password }>`. A spec reads it with `readSeed()` (`apps/web/e2e/seed.ts`).
- The seed also keeps the earlier "assistant" of each project. The setup link of that user goes to `auth.spec.ts` test 4. The member is a separate user.
- `account.spec.ts` changes the member's password and signs out everywhere. A new run needs a new seed: the global setup wipes and seeds every run.
- Blocks of `x-forwarded-for` (the rate limit is by address): settings 60 and 160, rules 70 and 170, account 80 and 180. S5a used 10 and 110, S5b used 40 and 140.
- `cleanUpOrg(page)` unlinks Telegram, removes every mailbox, deletes every rule, sets the organization to `{ timezone: "Europe/Warsaw", styleText: null }` and sets the signed-in user's digest times to `[]`.
- A spec of the owner connects its own GreenMail mailbox (`mailboxAddress(project)`). GreenMail has only INBOX, so the Synced folders card shows one row.
- Playwright result after stage 11: 30 passed (15 mobile, 15 desktop). It was 20 before.

## Other facts for the next agents

- Rules (`sender_rules`): the foreign key `(mailbox_id, org_id)` makes an insert with another organization's mailbox fail with `23503`. The unique index is `(org_id, mailbox_id, pattern, kind) NULLS NOT DISTINCT`. The service maps `23503` to `mailbox_not_found` only for a mailbox id and only in its own transaction.
- The cap is `SENDER_RULE_LIMIT = 1000`. Two adds at the same time can pass the cap by one or two rows. At the cap a duplicate answers `limit`, not `exists`. Both are accepted.
- `GET /api/rules?mailboxId=` of another organization's mailbox answers **200 with the org-wide rules**, not 404 (B8). Nothing leaks.
- The rule audit rows (`rule.added`, `rule.removed`) hold `rule_id`, `kind`, `scope` and `mailbox_id` for a mailbox rule. They never hold the pattern.
- `org.timezone_changed` holds `{ from, to }`. The digest times route writes no audit row (the CLI writes none).
- `config` reads `mailboxes` for `mailboxInOrg` (as `getMovesSupported` does), because `config` cannot import `mail`.
- `settingsRoutes` gets `goNoGo`, `setAuto`, `listSyncFolders` and `setSyncFolder` as injected functions from `web.ts` (`settingsRouteDeps`).
- `settingsDeps(db, now)` in `composition.ts` is the one `SettingsDeps` builder. The CLI and `web.ts` call it.
- A settings route with a mailbox that has no `mailbox_settings` row answers 404 (`SettingsNotFoundError`).
- `ApiError.raw` keeps the parsed error body. The 409 `no_go` gate is read from it. `useResource.mutate(data)` puts a PATCH answer into the resource and drops an older load that started before it.
- A form under polling keeps its draft with `lib/draft.ts` (`nextDraft`) and the hook `lib/use-draft.ts`.
- Counts after stage 11: unit 1657, integration 1210, Playwright 30.

## Deviations from the plan, by stage

- **Stage 1.** The `web-me` test sets the digest times to `[]` first, because the column default is `08:00` and `16:00`.
- **Stage 2.** None in the code. The review added a test for a `go` point above 0.5 (the threshold reaches the policy) and a CLI test for the gate log line. Both are in a test-only fix commit (`7bf854e`).
- **Stage 3.** The CLI `refused: …` lines go through `log.error` (stderr). Test case 9 sets `created_at` by SQL. Fix commit: `23503` maps to `mailbox_not_found` only for a mailbox id (the review found that it also mapped a bad organization id).
- **Stage 4.** The route matrix has no 404 row, because these routes take no id. A user without a membership gets 403. A minor fix: the test reads the owner's digest times before the PATCH (fixed in the stage 5 commit).
- **Stage 5.** `config/routes.ts` imports `z` from `zod` (like `mail/connect.ts`). A test-only fix commit (`153ffa2`) adds the `mailbox.switch_changed` row and actor assertion, the other organization's owner getting 404, and the body of the POST 404 answers.
- **Stage 6.** `parseQuery` in `platform/http.ts` parses the whole query object. It needs a non-strict schema.
- **Stage 7.** Step 7.1 added six keys that 7.2 then moved into the S5c block. A new test `i18n/en.test.ts` checks that every message of the core schemas has an `en` key. An extra key `empty_patch`.
- **Stage 7 strings (group review fix).** `anyway_text_quiet` is the key for urgent and needs_reply (the Q4 text was wrong for them). It starts with "{category} did not pass the check.". The `cat_effect_urgent` and `cat_effect_needs_reply` texts now say that auto does not move this mail, but moves it back from the junk folder.
- **Stage 8.** The three cards take an optional `onMissing()` prop. `patchSettings` lives in `lib/settings-api.ts`. `useResource` also ignores a load that started before a `mutate`. Fix commit (`edd96d8`): the selected mailbox is derived in render (no "No mailbox yet" flash), and a settings 404 that survives the list reload shows `set_load_error` with Retry.
- **Stage 9.** New `lib/use-draft.ts` and `lib/password-errors.ts` (5 tests). The first build showed the Account and Digest times cards only after `GET /api/organization` loaded. The review FAILED this (round 1: 2 major, 2 minor). The fix (`d7b73ef`): the cards no longer wait for the organization request. `signOutAllResult` checks the result. The Signature and Digest inputs are disabled while saving. `sig_counter` and `digest_help` take `{max}` from the constants. Round 1 fix review: PASS.
- **Stage 10.** `AddRuleForm` has an `onMissingMailbox()` prop. The form sits in the keyed `RulesBody`, so a change of the filter clears it.
- **Stage 11.** No audit-row check for `web.password_changed` in `account.spec.ts` (there is no e2e audit helper). A `consoleErrors(page)` helper. The second browser context uses `browser.newContext({ baseURL, extraHTTPHeaders })`. `cleanUpOrg` also resets the digest times (the plan said rules and organization only).
- **Plan changes decided at the cold review, not at the build:** B2 (a result union, `forced` only when the gate did not pass), B6 (no `triage/routes.ts`), B9 (one `updateOrganizationSettings`), B10 (the server's time-zone list). The master plan has dated lines for each.

## Review notes that stay open

1. **Stage 10 minor 2.** The add form resets when the mailbox filter changes (accepted).
2. **No audit row for "Sign out everywhere"** (see above; `web-public-hardening.md`).
3. **No e2e assertion of `web.password_changed`.** The S5a integration test covers the row.
4. **The sender and chaser half of the timezone fact has no test.**
5. **`atConfidence` of a `no-go` row is always 0.5.** The web text says "at confidence ≥ 0.5".
6. **Stage 4: `docs/modules.md` needs the `tenancy → audit` edge** (`tenancy/service.ts` imports `../audit`). S5e owns `docs/modules.md`. The line is in `tasks/planned/s5e-web-deploy-docs.md`.
7. **Stage 8 (accepted):** a per-switch pending state can reorder two answers until the next poll. No test for the `useResource` sequence ref (no React harness).
8. **Checked and not tested.** Checked: the shadcn `textarea` changed no package (`git diff --exit-code bun.lock apps/web/package.json` exit 0). Not tested: `<input type="time">` on iOS Safari (the S5e hand check on the phone covers it).
