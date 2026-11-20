# F125 stage 06 — Reader review: integration and e2e tests

Stage base: `1e309703` (master at the job start). Data: `audit/data/cases.tsv`, `groups.tsv`, `junit-cases.tsv` (scan base: the stage 01 and 02 commits `3dccad6c` and `908fe9b7`). Method: `plan.md` § Reader method, § Rules for the classes.

Path shorthand in the tables: `int/` = `apps/server/test/integration/`, `test/` = `apps/server/test/`, `src/` = `apps/server/src/`. Keys are `file:line` of the data files. Three files changed after the data base: `cli-streams-other.test.ts`, `credentials-check.test.ts`, `mail-sync.test.ts`; their keys can differ from the line in the file now, and a cut stage re-resolves them by name (Cut stage rule 2).

`unit-int-pairs.tsv` (stage 05) did not exist in `master` at the job start; the unit twins are named in the Evidence column of each row.

Findings that hold for many rows:

- **S8 over-flags int cases.** Of the 79 int rows with S8, almost all are false positives: the test file imports only fixtures (`./fixtures`, `./web-helpers`, `./web-reply-kit`) or spawns a script process, and the fixture or the script imports the production code. S8 is true only for tests of a test helper (`test/fake-oidc.test.ts`, `test/totp.test.ts`).
- **Table-driven CLI cases (`unscanned`).** 20 JUnit cases came from loops over a list with no matching scan row (stage 02 join check); they are read as 4 items by file and line.
- **No e2e case is flagged** (`cases.tsv`: 0 of 225 `e2e` rows have a flag), so § e2e holds no item.

## Integration

| # | Keys | Flags | Action | Rule | Kept key | Evidence | Lines | Time (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | test/contract/mail-sender.ts:133 | S1,S7 | KEEP | K4 | - | Conditional `test.skip` inside the shared contract module: an adapter that cannot refuse a login (plan.md K4, not FIX-NEVER-RUNS). | 0 | 0.00 |
| 2 | test/fake-oidc.test.ts:61 | S8 | KEEP | unsure | - | S8 is true: the case tests the test helper `fake-oidc.ts`. The helper has no real counterpart to test and the SSO int tests depend on it; the file header says it must be as strict as a real IdP. Happy path of the helper, 7 lines. | 0 | 0.00 |
| 3 | test/fake-oidc.test.ts:69 | S8 | KEEP | unsure | - | Helper strictness (PKCE challenge). Same reason as row 2; refusal paths protect the SSO tests (auth) from a lax fake. | 0 | 0.00 |
| 4 | test/fake-oidc.test.ts:76 | S8 | KEEP | K3 | - | Helper refuses unregistered redirect_uri and client_id: keeps the SSO callback tests honest (auth). | 0 | 0.00 |
| 5 | test/fake-oidc.test.ts:85 | S8 | KEEP | K3 | - | Helper refuses a missing or wrong PKCE verifier: auth flow. | 0 | 0.00 |
| 6 | test/fake-oidc.test.ts:92 | S8 | KEEP | K3 | - | Helper refuses a reused code, a wrong secret, another redirect_uri: auth flow. | 0 | 0.00 |
| 7 | int/channels-digest-brief-consent.test.ts:56 | S8 | KEEP | K3 | - | S8 is a false positive: the file calls `runDigests` from the fixtures, which import `scheduleDigests` from `src/modules/channels`. The case checks that no address, loop subject or loop text leaves in a digest without current consent (privacy, no leak markers). | 0 | 0.08 |
| 8 | int/channels-digest-brief-consent.test.ts:86 | S8 | KEEP | K3 | - | Same false positive as row 7. Consent versions and unlink: who sees the lines (privacy gate). | 0 | 0.21 |
| 9 | int/channels-digest-brief-consent.test.ts:117 | S8 | KEEP | K3 | - | Same false positive as row 7. Covered member gets the lines; uncovered member still gets counts only (consent gate). | 0 | 0.15 |
| 10 | int/channels-digest-brief-sections.test.ts:18 | S8 | KEEP | K6 | - | S8 false positive: `runDigests` runs the real digest job. Urgent-mail section of the brief: stated in `docs/capabilities/digest-and-notices.md`. 90 lines, 0.05 s. | 0 | 0.05 |
| 11 | int/channels-digest-brief-sections.test.ts:109 | S8 | KEEP | K6 | - | Same as row 10: needs_reply section (`docs/capabilities/digest-and-notices.md`). | 0 | 0.04 |
| 12 | int/channels-digest-brief-sections.test.ts:163 | S8 | KEEP | K6 | - | Same as row 10: delegation due-date section (`docs/capabilities/digest-and-notices.md`). | 0 | 0.06 |
| 13 | int/channels-digest-brief-sections.test.ts:192 | S8 | KEEP | K3 | - | Same as row 10: one organization sees only its own loops, mail and delegations (tenant isolation). | 0 | 0.05 |
| 14 | int/channels-digest-brief-sections.test.ts:216 | S8 | KEEP | K6 | - | Same as row 10: Polish lines and dates (texts carry a locale). | 0 | 0.03 |
| 15 | int/channels-digest-brief-sections.test.ts:228 | S8 | KEEP | K6 | - | Same as row 10: usual reply time of a contact loop (`docs/capabilities/open-loops.md`). | 0 | 0.03 |
| 16 | int/channels-digest-brief-sections.test.ts:243 | S8 | KEEP | K6 | - | Same as row 10: Polish form of the usual reply time. Same shape as row 14 but a different section; kept. | 0 | 0.03 |
| 17 | int/channels-digest-brief-sections.test.ts:256 | S8 | KEEP | K6 | - | Same as row 10: shadow mailbox wording. | 0 | 0.02 |
| 18 | int/channels-digest-brief-sections.test.ts:281 | S8 | KEEP | K6 | - | Same as row 10: the "+n more" link with and without a double slash. | 0 | 0.03 |
| 19 | int/e2e-seed.test.ts:91 | S7 | FIX-NEVER-RUNS | F6 | - | `describe.skipIf(e2eAppUrl === "" \|\| e2eMigratorUrl === "")` at `e2e-seed.test.ts:90`. At stage base 1e309703: the `ci` job in `.github/workflows/ci.yml` sets no `E2E_*` key; the `e2e` job sets both URLs (lines 94-95) but runs only `bun run test:e2e` (line 118) = Playwright (`package.json` `test:e2e`), not `bun test`; `scripts/limen-prepare.sh` has no `E2E` key; `test:int` sets no E2E env. The case runs nowhere. Propose: run `bun test apps/server/test/integration/e2e-seed.test.ts` in the `e2e` job before `test:e2e` (the job has the URLs and a migrated e2e DB), or delete. F136 may change this file and `limen-prepare.sh`: its branch `limen/2026-11-19-f136-stage-01-113388e9` is open (Cut stage rule 3 blocks a cut). | 0 | 0.00 |
| 20 | int/e2e-seed.test.ts:169 | S7 | FIX-NEVER-RUNS | F6 | - | Same `describe.skipIf` as row 19 (line 90); this case is the second one in the skipped describe. Same fix. | 0 | 0.00 |
| 21 | int/mail-oauth-login.test.ts:29 | S1 | REWRITE-WEAK | - | - | S1: no `expect`; the case passes when `verifySmtpLogin` does not throw (it returns `Promise<void>`, `modules/mail/imap/smtp.ts:129`). Proposed: `await expect(verifySmtpLogin({...})).resolves.toBeUndefined();` so the assertion is explicit. Not a cut. | 0 | 0.09 |
| 22 | int/privacy-address-pattern-use.test.ts:16 | S8 | KEEP | K3 | - | S8 true by imports, but the file reads source files, no DB: a static guard that the address pattern runs only through `matchesAddress` and `replaceAddress` (privacy; guards the next change, K2). It could sit in the unit lane (no DB, no IMAP) but it runs in 0.000 s: moving saves nothing. | 0 | 0.00 |
| 23 | int/privacy-address-pattern-use.test.ts:20 | S8 | KEEP | K3 | - | Same file: scan of the privacy module for `~`, regexp functions and flag `i` (privacy, K2). | 0 | 0.00 |
| 24 | int/privacy-address-pattern-use.test.ts:27 | S8 | KEEP | K3 | - | Same file: the two helpers write the case-sensitive forms (privacy, K2). | 0 | 0.00 |
| 25 | int/process-guard.test.ts:22 | S8 | KEEP | K3 | - | S8 false positive: the case spawns a process (`crash-entry.ts` imports `platform/log` and `process-guard`). A crash and its exit code need a real process; no unit twin. Checks that no secret marker leaves in an unhandled rejection (log redaction). | 0 | 0.01 |
| 26 | int/process-guard.test.ts:30 | S8 | KEEP | K3 | - | Same as row 25 for an uncaught exception. | 0 | 0.01 |
| 27 | int/process-guard.test.ts:38 | S8 | KEEP | K3 | - | Same as row 25 for a library `console.error` (the console guard drops the text). | 0 | 0.01 |
| 28 | int/rules-cli.test.ts:55 | S8 | KEEP | unsure | - | CLI `rules`: this is the one wiring case (exit 0, one output line, audit row with actor `cli`). Unit twins of the logic: `packages/core/src/triage/rules.test.ts:151` (pattern rules), `apps/server/test/integration/config-rules.test.ts` (service). The audit row also reads as K3. | 0 | 1.43 |
| 29 | int/rules-cli.test.ts:71 | S8 | DELETE-DUP | - | packages/core/src/triage/rules.test.ts:157; int/rules-cli.test.ts:55 | Re-checks `isValidSenderPattern("@firma.test") === false`, which `rules.test.ts:157` ("refuses everything else", includes `"@x.pl"`) checks. The `usage:` stderr and exit 1 are the same `cli.fail` path as in the usage cases of the other CLIs. 5 lines, 0.64 s. | 5 | 0.64 |
| 30 | int/rules-cli.test.ts:77 | S8 | KEEP | unsure | - | CLI wiring for the `mailbox_not_found` result (`rules.ts:101`, exit 1, `refused: mailbox not found` on stderr, no stdout). The service result is tested at `config-rules.test.ts:112`, but the mapping to the CLI line is tested only here. | 0 | 0.58 |
| 31 | int/sso-schema.test.ts:152 | S1 | REWRITE-WEAK | - | - | S1: the case inserts an https issuer and asserts nothing; an insert that does not throw is the check. Proposed: after `insertProvider`, read the row back: `expect((await sql<{ issuer: string }>`select issuer from sso_providers where org_id = ${A.orgId}::uuid`.execute(trx)).rows).toEqual([{ issuer: "https://login.microsoftonline.com/t/v2.0" }]);`. | 0 | 0.01 |
| 32 | int/telegram-api-root.test.ts:47 | S8 | KEEP | unsure | - | S8 false positive: spawns `telegram-check.ts` against a local fake server; the wiring case of `telegram:check` with `TELEGRAM_API_ROOT` (requests `/bot<token>/getMe`). No unit twin of the script. | 0 | 1.23 |
| 33 | int/telegram-api-root.test.ts:54 | S8 | KEEP | K3 | - | Refuses a non-loopback API root and prints no token: secrets in output. The loopback rule lives in the script path; no unit twin. | 0 | 1.19 |
| 34 | int/testmail-cli.test.ts:131 | S8 | KEEP | K3 | - | Send guard: without `TEST_MAILBOX_ADDRESS` nothing is sent and no runs folder is written (no send outside the pinned test address). The guard lives in `scripts/testmail.ts`; no unit twin (the unit tests of `modules/testmail/` cover `runSend`, not the CLI guard). | 0 | 0.34 |
| 35 | int/testmail-cli.test.ts:140 | S8 | KEEP | K3 | - | Send guard: an AgentMail address is refused. No unit twin. | 0 | 0.28 |
| 36 | int/testmail-cli.test.ts:150 | S8 | KEEP | K3 | - | Send guard: an address that differs from `target.json`, or a non-address, is refused; no request, no runs folder. No unit twin (`target.test.ts` covers `loadRemoteTarget` only). | 0 | 0.55 |
| 37 | int/testmail-cli.test.ts:164 | S8 | KEEP | unsure | - | Core `packages/core/src/testmail/batch.test.ts` checks the `blind_disagrees` rule; this case proves that the CLI send stops (exit 1, no request) and validate prints the code. 0.76 s: a cut saves little. | 0 | 0.76 |
| 38 | int/testmail-cli.test.ts:179 | S8 | KEEP | unsure | - | Wiring: a missing batch file gives `file not found` with no stack trace. 0.27 s. `target.test.ts:59` covers a missing target file, not a missing batch file. | 0 | 0.27 |
| 39 | int/testmail-cli.test.ts:186 | S8 | KEEP | unsure | - | Wiring of `blind` view and `--apply`; the logic is in `packages/core/src/testmail/blind.test.ts`. The case checks that the view prints no `expected` (blind labelling must not leak) and that the file is written. 0.59 s. | 0 | 0.59 |
| 40 | int/testmail-cli.test.ts:208 | S8 | KEEP | K3 | - | `--dry-run` needs no API key, makes no request and the key is not in the output (secrets). | 0 | 0.38 |
| 41 | int/testmail-cli.test.ts:218 | S8,S9 | KEEP | K3 | - | Only case that proves one send per case to the pinned test address and the status line; the loop waits 5 s (`--interval-sec` minimum is 5, `scripts/testmail.ts:70`), so the time is real wait. Unit twin of the logic: `modules/testmail/send.test.ts:131`, `:149` and `:287` (to the test address only). No cut found without changing the 5 s minimum. | 0 | 6.32 |
| 42 | int/testmail-cli.test.ts:241 | S8,S9 | KEEP | unsure | - | Case-insensitive match of the pinned address (guard, K3 side). No unit twin of the guard. It spends 5.6 s, nearly all of it the 5 s wait between two sends. Idea for the parallel-runs ticket, not a cut: use `--limit 1` if `send.ts` skips the wait after the last allowed send (`send.ts:316` sets `needPace` after a send; not verified). | 0 | 5.61 |
| 43 | int/testmail-cli.test.ts:252 | S8 | KEEP | unsure | - | The `send log damaged` stop lives in `scripts/testmail.ts:109`; `log-file.test.ts` covers the reader that names bad files, not the stop. Kept; it is also the kept key of row 44. | 0 | 0.30 |
| 44 | int/testmail-cli.test.ts:262 | S8 | DELETE-DUP | - | src/modules/testmail/lock.test.ts:20; int/testmail-cli.test.ts:252 | A live lock throws `HardError("another testmail send runs")` (`modules/testmail/lock.ts:54`), tested at `lock.test.ts:20`; the exit 1 and stderr mapping of a `HardError` is the same path that row 43 proves. 9 lines, 0.29 s. | 9 | 0.29 |
| 45 | int/testmail-cli.test.ts:274 | S8 | KEEP | unsure | - | `setup` creates the inbox only on a 404 and a second run only reads: request sequence GET/POST/GET and GET. No unit twin of the CLI command (`agentmail/client.test.ts` covers the client). | 0 | 0.54 |
| 46 | int/testmail-cli.test.ts:295 | S8 | KEEP | unsure | - | One of three usage cases of one CLI (no command, unknown option, missing option). Each takes a different parse branch of `scripts/testmail.ts`; the stream is what it pins. 0.27 s each: kept. | 0 | 0.27 |
| 47 | int/testmail-cli.test.ts:301 | S8 | KEEP | unsure | - | As row 46 (unknown option). | 0 | 0.28 |
| 48 | int/testmail-cli.test.ts:307 | S8 | KEEP | unsure | - | As row 46 (missing option; usage plus issue line). | 0 | 0.28 |
| 49 | int/testmail-cli.test.ts:315 | S8 | KEEP | unsure | - | Wiring: `inbox not found` stream when `send` runs before `setup`; no request is sent. | 0 | 0.30 |
| 50 | int/testmail-cli.test.ts:323 | S8 | KEEP | unsure | - | Wiring: refusal when the inbox address differs from the persona file. | 0 | 0.29 |
| 51 | int/testmail-cli.test.ts:338 | S8 | KEEP | unsure | - | Wiring: a down server prints `failed: SoftError` on stderr. | 0 | 0.27 |
| 52 | int/web-operator-page.test.ts:53 | S8 | KEEP | K3 | - | S8 false positive: `webTestApp` builds the real app (`platform/http`). Operator console guard: a non-operator gets 404 in every path form (`requireOperator`, the cross-organization path). | 0 | 0.00 |
| 53 | int/web-operator-page.test.ts:78 | S8 | KEEP | K3 | - | Same: the operator gets the page. | 0 | 0.00 |
| 54 | int/web-operator-page.test.ts:89 | S8 | KEEP | K3 | - | Same: no session redirects to login. | 0 | 0.00 |
| 55 | int/web-operator-page.test.ts:95 | S8 | KEEP | K3 | - | Same: the guard does not leak; the owner still reads `/settings`. | 0 | 0.00 |
| 56 | int/web-operator-page.test.ts:101 | S8 | KEEP | K3 | - | Same: an operator without TOTP goes to settings in every path form; a non-operator still gets 404. | 0 | 0.01 |
| 57 | int/web-operator-page.test.ts:129 | S8 | KEEP | K3 | - | Same: the operator with TOTP on still gets the page. | 0 | 0.00 |
| 58 | int/web-operator-page.test.ts:135 | S8 | KEEP | K3 | - | Same: a web without `operatorUserIds` refuses the operator user too. | 0 | 0.00 |
| 59 | int/web-reply-guards.test.ts:71 | S8 | KEEP | K6 | - | S8 false positive: `replyWebKit` mounts the real reply routes. Flag-off answers 404 as for an unknown id (default-off feature flag rule, `docs/capabilities/reply-drafts.md`). | 0 | 0.40 |
| 60 | int/web-reply-guards.test.ts:92 | S8 | KEEP | K6 | - | Same: with a flag off nothing is written. | 0 | 0.08 |
| 61 | int/web-reply-guards.test.ts:116 | S8 | KEEP | K3 | - | Same: a member gets 403 `owner_only` on each write (role check). | 0 | 0.10 |
| 62 | int/web-reply-guards.test.ts:144 | S8 | KEEP | K3 | - | Same: 401 without session; a foreign Origin gives 403 and changes nothing. | 0 | 0.07 |
| 63 | int/web-reply-guards.test.ts:187 | S8 | KEEP | K3 | - | Same: ids of the other organization answer 404 and change nothing (tenant isolation). | 0 | 0.10 |
| 64 | int/web-reply-guards.test.ts:227 | S8 | KEEP | unsure | - | Same: bad id, non-JSON body, extra key, too long: 400 (route test rule 400). Kept: validation of a send route. | 0 | 0.06 |
| 65 | int/web-reply-recipients.test.ts:50 | S8 | KEEP | K6 | - | S8 false positive: real routes through `replyWebKit`. Reply all: To is the sender, Cc the others (`docs/capabilities/reply-drafts.md`). | 0 | 0.24 |
| 66 | int/web-reply-recipients.test.ts:79 | S8 | KEEP | K6 | - | Same: Use Reply-To rules. | 0 | 0.13 |
| 67 | int/web-reply-recipients.test.ts:96 | S8 | KEEP | K3 | - | Same: refusals (`no_reply_to`, `no_others`, `too_many_recipients`); a bounded recipient list. | 0 | 0.15 |
| 68 | int/web-reply-recipients.test.ts:118 | S8 | KEEP | unsure | - | Same: strict body (400 validation), nothing changes. | 0 | 0.12 |
| 69 | int/web-reply-recipients.test.ts:140 | S8 | KEEP | K3 | - | Same: Reply all with a different Reply-To goes to the sender, never to the Reply-To (recipient rule). | 0 | 0.14 |
| 70 | int/web-reply-recipients.test.ts:159 | S8 | KEEP | K3 | - | Same: a +tag variant of the own mailbox is no recipient (recipient rule). | 0 | 0.13 |
| 71 | int/web-reply-recipients.test.ts:177 | S8 | KEEP | K3 | - | Same: a stored address with a display name: the service sends to the bare address (recipient rule). | 0 | 0.17 |
| 72 | int/web-reply-recipients.test.ts:210 | S8 | KEEP | K3 | - | Same: an old Send answers 409 `changed` and approves nothing; only the new version sends (no send without approval). | 0 | 0.14 |
| 73 | int/web-reply-recipients.test.ts:232 | S8 | KEEP | K3 | - | Same: an approved send answers 409 `closed` and keeps its recipients (exactly once). | 0 | 0.13 |
| 74 | int/web-reply-routes.test.ts:40 | S8 | KEEP | K6 | - | S8 false positive: real routes plus `runJob`. POST /api/replies: 202, status pending then done (`docs/capabilities/reply-drafts.md`). | 0 | 0.17 |
| 75 | int/web-reply-routes.test.ts:71 | S8 | KEEP | K3 | - | Same: the audit row holds ids and codes only, not text (privacy). | 0 | 0.07 |
| 76 | int/web-reply-routes.test.ts:102 | S8 | KEEP | K3 | - | Same: a flagged mail answers 409 blocked/suspicious; nothing queued (suspicious mail, no send). | 0 | 0.07 |
| 77 | int/web-reply-routes.test.ts:126 | S8 | KEEP | K3 | - | Same: unknown mail, other organization's mail, a mailbox switched off: queue nothing (tenant isolation). | 0 | 0.06 |
| 78 | int/web-reply-routes.test.ts:152 | S8 | KEEP | unsure | - | Same: a line over 300 characters answers 400 without echoing the text. | 0 | 0.07 |
| 79 | int/web-reply-routes.test.ts:173 | S8 | KEEP | K3 | - | Same: the line never lands in the answer, logs or audit rows (log redaction, privacy). | 0 | 0.17 |
| 80 | int/web-reply-routes.test.ts:214 | S8 | KEEP | unsure | - | Same: a 301-character line, an empty line, control characters, an unknown key: 400 and no row. Close to row 78 (length bound) but adds control-character and unknown-key inputs; kept. | 0 | 0.11 |
| 81 | int/web-reply-routes.test.ts:246 | S8 | KEEP | K3 | - | Same: a superseded send answers 409; the sixth redraft answers `redraft_limit`. | 0 | 0.15 |
| 82 | test/totp.test.ts:6 | S8 | KEEP | unsure | - | S8 true: tests the helper `apps/server/test/totp.ts` (RFC 6238 vectors) used by the web two-factor int tests. 4 lines, 0.001 s. | 0 | 0.00 |
| 83 | test/totp.test.ts:11 | S8 | KEEP | unsure | - | Helper `secretOfUri`; same file as row 82. | 0 | 0.00 |
| 84 | test/totp.test.ts:16 | S8 | KEEP | unsure | - | Helper `holdsToken` (a 6-digit code as a whole token, not part of a longer number): used by int tests that look for codes in mail text; a lax helper would hide a wrong code. | 0 | 0.00 |
| 85 | int/mail-moves.test.ts:471 | unscanned | KEEP | unsure | - | `unscanned`: the 2 JUnit cases of one `test.each` (`mail-moves.test.ts:471`) did not join to a scan row. Move detection by UID and Message-ID: another mail at the same UID is no hit. No flag besides the join gap. | 0 | 0.01 |
| 86 | int/mailbox-cli-streams.test.ts:153 | unscanned | KEEP | unsure | - | `unscanned`: 6 JUnit cases of a loop over scripts (`mailbox-cli-streams.test.ts:153`, 6 spawns, 0.7-1.4 s each, 6.5 s). Each takes the usage path of a different script; the stream per script is the check. A static rule (a lint that every script prints its usage with `cli.fail`) could replace the spawns; this is an owner decision, so no cut row. | 0 | 6.72 |
| 87 | int/mailbox-cli-streams.test.ts:175 | unscanned | KEEP | unsure | - | `unscanned`: 8 JUnit cases of a loop (`mailbox-cli-streams.test.ts:175`, a down DB, 8 spawns, 0.7-1.4 s each, 8.6 s). Same family and reason as row 86; the `failed:` branch is a different path from the usage branch. | 0 | 8.14 |
| 88 | int/retention-job.test.ts:434 | unscanned | KEEP | K3 | - | `unscanned`: 4 JUnit cases of a loop (`retention-job.test.ts:434`): retention rows in a paused mailbox, a suspended organization and with triage off (retention rule). | 0 | 0.33 |
| 89 | int/mail-connect.test.ts:324 | S2 | REWRITE-WEAK | - | - | S2: `expect(await getMailbox(...)).toBeDefined()` after a connect. Proposed: `expect(await getMailbox(trx, { orgId: b.orgId }, mailboxId)).toMatchObject({ address })`. K3 side: the same address in two organizations connects (tenant isolation). | 0 | 0.01 |
| 90 | int/trust-repo.test.ts:86 | S2 | REWRITE-WEAK | - | - | S2: two `.not.toBeNull()` checks on `queueHistoryCheck`. Proposed: `const first = await queueHistoryCheck(...)`, `const second = await queueHistoryCheck(trx, o, other, "connect")`, `expect(typeof first).toBe("string")`, `expect(typeof second).toBe("string")`, `expect(second).not.toBe(first)` (each mailbox has its own check). | 0 | 0.00 |
| 91 | int/cli-streams-other.test.ts:249, int/cli-streams-other.test.ts:372, int/cli-streams-other.test.ts:409 | S6 | MERGE-TABLE | - | - | T13 in `cli-streams-other.test.ts` (3 cases: `:249` org-status bad `--org-id`, `:372` triage-cost bad option, `:409` triage-label bad option; keys at the scan base, the file changed since). Proposed: `test.each([["org-status", ["--org-id", "nope"], "usage: bun run org:status"], ["triage-cost", [...], "usage: ..."], ["triage-label", [...], "usage: ..."]])("%s: a bad option: the usage on stderr, exit 1", ...)`. 0.9 s each; saves lines, not time. | 10 | 2.05 |
| 92 | int/cli-streams-other.test.ts:301, int/cli-streams-other.test.ts:378, int/cli-streams-other.test.ts:444 | S6 | MERGE-TABLE | - | - | T14 (3 cases: `:301` telegram-unlink, `:378` triage-cost, `:444` triage-label: "a database that is down: `failed:` on stderr"). The same file already has a table for this check (`describe("failed lines of the database scripts")`, array `scripts`, 4 scripts with 2 tests each). Proposed: add `telegram-unlink`, `triage-cost`, `triage-label` (and `org-status`, `:274`, the same case but outside the group) as entries of that `scripts` array and delete the single cases. Same spawns, fewer lines. | 21 | 2.00 |
| 93 | int/cli-streams-other.test.ts:309, int/cli-streams-other.test.ts:386, int/cli-streams-other.test.ts:452 | S6 | MERGE-TABLE | - | - | T15 (3 cases: `:309` telegram-unlink, `:386` triage-cost, `:452` triage-label: "a missing DATABASE_URL: `failed:` on stderr"). Same table and plan as row 92 (the second test of each `scripts` entry already covers a missing `DATABASE_URL`). | 21 | 2.12 |

## e2e

(in progress)

## Summary

(in progress)
