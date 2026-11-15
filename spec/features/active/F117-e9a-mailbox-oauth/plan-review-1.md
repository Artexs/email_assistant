FAIL 52ccd97e8b9a0a2dd492255fe67142a1c466a6de

The plan for F117 (mailbox OAuth, 21 stages) has six blocking findings. The decisions are sound. Most defects are conflicts between the plan and the code at HEAD. Some defects are conflicts between two stages. HEAD = 52ccd97e8b9a0a2dd492255fe67142a1c466a6de, so it matches the candidate. `scripts/plan-drift.sh … 09789b10` gives "no drift", exit 0.

## Blocking

**B1. A refused login has the wrong error type: `SmtpSendError` stage `login` where the code throws `MailAuthError`.** Proven by a code read. Pre-mortem: a Microsoft user withdraws consent. Each Graph send then fails as `smtp_error` after its retries, and the mailbox never goes to `auth_error`. Stage 13 lets this through.
- The plan says a refused login gives `SmtpSendError` stage `login` in these places:
  - `stages/stage-04-auth-material.md:32` (test 4: 535 → `SmtpSendError` stage `login`).
  - `stages/stage-05-sender-factory.md:29` (contract case 5).
  - `stages/stage-10-refresh.md:24` (Google SMTP refused → `SmtpSendError` `login`, reason `protocol_disabled`).
  - `stages/stage-13-graph-sender.md:21-22` (401 twice and 403 → `login` with a reason).
  - D15 at `plan.md:29` puts `reason` on `SmtpSendError`.
- The code does something different:
  - `apps/server/src/modules/mail/imap/smtp.ts:88-89` and `:197` map EAUTH to `MailAuthError`, not to `SmtpSendError`.
  - `apps/server/src/modules/actions/send.ts:48` gives `{ kind: "auth_error" }` only for `MailAuthError`.
  - A `SmtpSendError` with stage `login` falls through to `send.ts:57-62`. That is a counted retry, then `failed smtp_error`. It never reads `reason` and never sets `auth_error`.
- Stage 04 also says "No behaviour change for password mailboxes" (`stage-04:7`). Test 4 and that sentence cannot both hold, so a worker must guess.
- Fix: a refused login is `MailAuthError` with `reason` everywhere, also for Graph 401 and 403. Or `sendOutcomeOf` maps `login` + `reason` to `auth_error`. Choose one and fix test 4, case 5, and stages 10 and 13 to match. Add a committer test: Graph 403 → mailbox `auth_error` with its reason.

**B2. Stage 06 and stage 09 use types that their listed "needs" do not supply.** Proven from the plan text.
- `plan.md:116` says "06–08 ∥ 04–05", and `plan.md:99` gives stage 06 "needs 03" only.
- Stage 06 uses three types from stages 04 and 05:
  - `TokenResource` (`stage-06:16`, `:42`), defined in `stage-05:44`.
  - `AuthErrorReason` (`stage-06:37`), defined in `stage-04:13`.
  - `OAuthGrantError` extends `HardError` with `reason: AuthErrorReason`.
- Stage 09 calls `oauthTokens.drop` (`stage-09:37`). That is the `OAuthTokens` interface of `stage-05:45-50`. But `plan.md:102` gives stage 09 "needs 04, 08", not 05.
- Result: a worker on stage 06 defines these types again, and the merge with 04 or 05 conflicts or duplicates them.
- Fix: stage 06 needs 05 (and through it 04). Or move `TokenResource` and `AuthErrorReason` into stage 03 or 06 and let 04 and 05 import them. Stage 09 needs 05.

**B3. No rule covers a Graph Sent Items copy that arrives late.** The gap is proven; the duplicate is plausible and depends on Graph timing.
- `stage-13:27` says the committer's "locate first, APPEND only if missing" "runs unchanged and finds it".
- `send.ts:232-237` (`saveSentCopy`) looks once, right after the send, and APPENDs on a miss.
- Graph `sendMail` answers 202 (`stage-13:18`). The spike row itself allows the copy to take "within 60 s" (`stage-01:28`).
- Pre-mortem: every Microsoft send leaves two copies in Sent Items. CI cannot see this, because the fake Graph and GreenMail save no Sent copy (`stage-13:46`). Only stage 21 check 4 can catch it.
- Fix: decide in stage 13. Options: for `send_via = 'graph'`, skip the APPEND and mark `sent_copy` as `pending`, then confirm it later. Or poll a set number of times with a set wait.

**B4. Stage 15's virtual-folder rule targets a route that has no folder path.** Proven by a code read.
- `stage-15:11` says the sync-folder setting refuses a folder with `\All`, `\Important` or `\Flagged` with `400 virtual_folder`. Tests 2 and 3 (`stage-15:28-29`) send `[Gmail]/All Mail` to "the sync-folder route" and expect the settings list to mark folders "not selectable".
- The route is `PATCH /settings/:mailboxId/sync-folders/:key` with a fixed key list (`apps/server/src/modules/config/routes.ts:137-139`). The body is `{ enabled }` only (`packages/core/src/web/settings.ts:72`).
- Folder rows come from fixed default names (`docs/capabilities/sync.md` rule 5). No path is chosen anywhere.
- A worker cannot write tests 2–3 without guessing.
- Fix: decide where a virtual folder could enter sync. Likely candidates are the default-name adder and `buildFolderMap`. Put the guard and the tests there, or drop the rule. The `virtual_folder` web text then has no use.

**B5. The stage 21 seed command gives only `info` and `notification` mail.** Proven from the data.
- `stage-21:19` runs `--eval-cases synthetic --limit 20` with no `--per-category`.
- `stage-20:18` defines `--limit` as "the first n cases by id after the per-category pick".
- `evals/cases/synthetic.json` holds 80 cases, 16 in each of 5 categories. Sorted by id, the first 20 are `syn-info-01..16` and `syn-notif-01..04`. There are no `needs_reply`, `urgent` or `spam` cases.
- U2 step 5 (`stage-21:11`) ("approve one delegation and one reply per mailbox") and check 4 (`stage-21:21`) then may have nothing to approve. Done-when 8 (`plan.md:60`) becomes empty.
- Delegation cases are in a separate `delegation.json` set.
- Fix: fix the command, for example `--per-category 4 --limit 20`. Name which set gives the delegation. Or define `--limit` to keep the category spread.

**B6. Stage 20's CLI tests cannot reach the fake token server under D6.** Proven from the existing test pattern.
- D6 (`plan.md:20`) says "no env key holds a URL; tests inject a replacement".
- CLI integration tests start the script as a subprocess (`apps/server/test/integration/mail-seed.test.ts:89`, `Bun.spawn`).
- Stage 20 tests 3, 6 and 7 (`stage-20:32-36`) run `mailbox:seed` and `mailbox:audit` on a Google OAuth mailbox. They need a fake `invalid_grant` and they check CLI stdout and stderr.
- A subprocess CLI uses the constant registry, so it calls the real `oauth2.googleapis.com`.
- Fix: choose one. Run the CLI `main()` in the test process with injected deps, or allow a test-only override and state it as an exception to D6.

## Notes

1. **Possible gap: the granted scopes may not match the requested names.** Plausible; I could not check it offline. `stage-08:35` requires every `mail` resource scope in the token answer. For Google, `mail` is "the same" as `openid email https://mail.google.com/` (`stage-06:29`). Google usually answers `email` as `https://www.googleapis.com/auth/userinfo.email`, and Microsoft may leave `offline_access` out of `scope`. Then every real connect would end in `oauth_scope_missing`. The fake token server echoes the request, and spike rows M2 and G1 (`stage-01:20`, `:38`) do not record the raw granted string. Only stage 21 would catch it. Suggest: check only the resource scopes (`https://mail.google.com/`, `IMAP.AccessAsUser.All`), and let the spike record the granted string.
2. **Stage numbers point to the wrong stage in several places** (proven). Most are off by one, from a stage that was added later:
   - `stage-01:9` (stage 18 deletes the kit → 19)
   - `stage-02:33` (ADR, stage 18 → 19)
   - `stage-09:69` (panel 16–17 → 16, 18)
   - `stage-11:8` (16–17 → 16, 18)
   - `stage-11:32` and `:52` (17 → 18)
   - `stage-12:13` and `:42` (17 → 18)
   - `stage-14:14`, `:15`, `:16`, `:39`, `:40` (16 → 17, 18 → 19)
   - `stage-15:22`: the app-password help-text change "in stage 18". No stage owns this change, and stage 18 does not need 15, so it may already be landed.
3. **Gate G1 conflicts with the stage "needs"** (proven). `plan.md:84`: "G2 FAIL → hold stage 15 and the Gmail half of 21". But 19 needs 15 (`plan.md:113`) and 21 needs 19, so all of 21 stops. In the same way, an M3 FAIL holds 17. That stops 18, 19 and the Gmail half of 21.
4. **AADSTS 65001 has two reasons, and no source is given for the codes.** `stage-06:50` maps 65001 to `oauth_revoked`. `stage-08:32` and `stage-09:30`/test 3 map it to `admin_consent_required`. Plan § Facts checked has no source for the AADSTS list in `stage-06:49-51`.
5. **Two interface gaps:**
   - Stage 06 returns an anonymous object type, but stages 08 and 10 use the name `MailOAuthClient`.
   - `stage-08:24` takes `clients: Record<MailOAuthProvider, …>`, but `stage-10:9` takes `Partial<…>`. A callback for a provider that is not configured cannot be typed under stage 08.
6. **Stage 10.2 needs a fact the interface does not give.** `stage-10:23` retries only "if the token came from the cache". `OAuthTokens.accessToken` returns a bare `Promise<string>` (`stage-05:47`), so the caller cannot know this. The plan should decide: always retry once with `fresh`, or widen the return type.
7. **Stage 13 test 8 needs stage 10.** `stage-13:46` runs the committer end to end with the fake token server, which needs the real `oauthTokens` of stage 10. But 13 runs ∥ 07–12 (`plan.md:116`). Either stub `oauthTokens` in that test, or make it need 10.
8. **Stage 21 does not set the scope keys.** It never names `SEND_SCOPE` or `ACTIONS_SCOPE`.
   - The default `SEND_SCOPE=off` holds every send.
   - With `self`, every recipient must match the list exactly (`apps/server/src/modules/actions/scope.ts:37-41`), so each of the 20 `owner+ea-smoke-NN@` addresses must be on it.
   - Check 3's moves need `ACTIONS_SCOPE` `synthetic` or `all`.
   - Plus addressing at the owner's domain is used without a source (`stage-20:19`).
9. **Wrong source pointer.** `plan.md:42` points R1–R7 and R10 to `notes/2026-11-13-mail-oauth-and-push-facts.md`. The R table is in `docs/product/stage-2/epics/E09-discovery-notes.md:38-47`.
10. **Stage 01 and the `bun.lock` rule.** `tools/*` is a workspace glob (`package.json:9`). A `package.json` in `tools/mail-oauth-spike/` changes `bun.lock`, which is against `plan.md:66`; deleting it in stage 19 does the same. Say "no package.json".
11. **Stage 09 is large.** It has three steps (secret store and lock, Connect/Reconnect, callback route) and 9 tests in 693 words. Consider a split after step 09.1.
12. **Pool connection held during HTTP.** Plausible. In `stage-10:13`, each refresh holds a pool connection and an open transaction during an HTTP call of up to 10 s. Say how many can run at once compared with the pool size.
13. **Board drift.** Report only, not repaired: `spec/build.md:61` still says "needs plan", and `05-execution-plan.md:56` says "≈ 19" stages against 21.

## Checks run
- `git rev-parse HEAD` → 52ccd97e8b9a0a2dd492255fe67142a1c466a6de. I ran it alone once more at the end; exit 0.
- `bun install --frozen-lockfile` (Bun 1.4.4 = `.bun-version`) → 995 packages, lockfile not changed.
- `bash scripts/plan-drift.sh spec/features/planned/F117-e9a-mailbox-oauth 09789b10` → "no drift". It ran in a chain with other commands, so its exit 0 is not a separate proof.
- `wc -w` → `plan.md` 1500, the largest stage 699. All are within § Plan size.
- Code reads for facts:
  - `mail/open.ts`, `mail/imap/smtp.ts`, `mail/port.ts`, `actions/send.ts`, `actions/committer.ts`, `actions/scope.ts`, `mail/jobs.ts`
  - `mail/repo/mailboxes.ts`, `mail/status.ts`, `mail/host-status.ts`, `mail/connect.ts`, `config/routes.ts`, `retention.ts`
  - `db/migrations` (secret_kind, `UNIQUE (id, org_id)`, `tenant_rows`, host_blocked)
  - nodemailer 10.3.1 XOAuth2 and smtp-connection: no `expires` → the token is reused, and a failure → EAUTH
  - `evals/cases/synthetic.json`, `scripts/mailbox-seed.ts`, `test/integration/mail-seed.test.ts`, `package.json`, `eslint.config.js`
  - Better Auth 1.7.18 session cookie: SameSite default lax. The cross-site GET callback carries the session, so this is not a finding.
- I ran no lint, typecheck or test suite. The candidate changes only plan Markdown, so those suites would show nothing about it.

## Note check
- HEAD is the candidate 52ccd97e: proven. `git rev-parse HEAD` (a single command, exit 0, output 52ccd97e8b9a0a2dd492255fe67142a1c466a6de).
- Every finding quotes a file and line and is marked blocking or note, and covers gaps, conflicts, guesses, unsourced facts, size, interfaces and order: proven. This final message: B1–B6 and notes 1–13 each cite `file:line`.
- Facts the plan uses are checked against the repo: proven. The key files read are `apps/server/src/modules/mail/imap/smtp.ts`, `apps/server/src/modules/actions/send.ts`, `apps/server/src/modules/config/routes.ts`, `evals/cases/synthetic.json` and `apps/server/test/integration/mail-seed.test.ts`.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each finding names a missing decision, interface, test, stage order or source. No finding asks only for line numbers, edit text or file lists.
