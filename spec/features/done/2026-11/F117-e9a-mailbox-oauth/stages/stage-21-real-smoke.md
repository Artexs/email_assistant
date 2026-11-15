# F117 stage 21 — Provider smoke on the real test mailboxes, then the VPS

Part of [`../plan.md`](../plan.md). `[risky]` (real system, real sends). Run by the coordinator in the main checkout (as the VPS stages of other tickets), not by a worker job. Needs stages 19, 20, gate G1 and owner step U2.

## Owner runbook (U2; real secrets, browser consent)

1. In the Entra app and the Google client of U1, add the redirect URIs of stage 19 for the dev panel host and the VPS panel host (one app per provider for the owner's two hosts; Q11).
2. Put the four `MAIL_OAUTH_*` keys into the dev `.env` and the VPS env file. In the dev `.env` only: `ACTIONS_SCOPE=synthetic`, `SEND_SCOPE=self`, `SEND_TEST_ADDRESSES` = your address plus `<local>+ea-smoke-01@<domain>` … `+ea-smoke-20@<domain>` (the `self` scope needs every recipient listed). No agent reads or prints the file.
3. Tell the coordinator "keys in". The coordinator turns on `mail_oauth_microsoft` and `mail_oauth_google` for the owner's test organization only and sets `TEST_MAILBOX_ADDRESS` to the two test addresses.
4. In the dev panel: Sign in with Microsoft (the Business Basic user) and Sign in with Google (the owner's Gmail). Set both to assist mode. Make your own address the only delegate of the test organization.
5. After the coordinator's seed (check 2): approve one delegation and one reply per mailbox in Telegram or the panel.
6. After check 4: remove the app's access at the provider (`myapps.microsoft.com`, `myaccount.google.com/permissions`), wait for the `auth_error` notice, then tap Reconnect.

## Coordinator checks (dev)

Write each result, with the command and its output line, into `spec/features/<lane>/F117-e9a-mailbox-oauth/smoke.md`. Ids, codes and counts only; no address, subject or token.

1. Both mailboxes `active`; Microsoft `send_via = graph`, Google `smtp`; `mailbox:audit` exit 0 after the first sync.
2. Per mailbox: `bun run mailbox:seed --org-id <test org> --mailbox-id <id> --eval-cases synthetic --per-category 3 --from-owner <owner address>` (`appended 15`), then the same with `--eval-cases delegation --per-category 5 --number-from 16` (`appended 5`).
3. Within 10 minutes: 20 new `emails` rows per mailbox, triaged; moves into `AI/*` done (`mailbox:audit` exit 0).
4. After U2 step 5: the four actions `applied`; the Microsoft sends went through Graph (one `send_started_at` each); the Sent copy is found, not appended twice; each mail arrived at an `owner+ea-smoke-…` address; no other recipient (read the `actions` rows' recipients by id).
5. After U2 step 6: the mailbox went `auth_error` with reason `oauth_revoked` or `oauth_expired`, one notice; after Reconnect `active`, the same mailbox id, the same `emails` count as before (plus new mail only).
6. The log of the run: `grep` for the canary shapes of stage 01's `redact` (`eyJ`, `ya29.`, `1//`, `M.C`, `EwB`) in the server log finds nothing (this is the acceptance).

A check that fails: stop, write it in `smoke.md`, ask the owner; no fix in this stage.

## VPS deploy

- The deploy steps of `deploy/README.md` with a backup first and a rollback image tag `ea-server:pre-f117`; `bun run db:migrate` on the VPS (stage 03 migration).
- Flags stay off for the pilot organization. The pilot mailbox is a password mailbox and must sync as before: 5 or more sync lines in 15 minutes and 0 failure lines.
- Health 200; `GET /api/mailboxes/oauth/options` for the pilot answers `connect: false` for both providers.
- Close after 24 h without a problem: remove the rollback image; `limen ticket done F117`.

**Decisions.** D18, D20, D21.

**Done when.** `smoke.md` shows checks 1–6 held for both providers and the VPS checks held.

**Out of scope.** Turning the flags on for the pilot (an owner decision after this ticket).

## Carry-over from the stage 08 review

Source: `review-8.md` (U1).

- **ID token at the code redeem.** `redeemCode` sends `scope` = the mail resource scopes only (IMAP and `offline_access`), with no `openid`. It was not checked whether Microsoft then returns an `id_token`. If it does not, `finishOAuthCallback` refuses every Microsoft connect with `oauth_failed` (no ID token, no address). Record in the rows M2 and M12: does the redeem answer hold `id_token`? Which claims does it hold (`email`, `preferred_username`, `tid`, `aud`, `iss`)? If no `id_token` comes, the fix is to add `openid email profile` to the `scope` of `redeemCode`, or to read the address another way: a stage 06/08 refresh job.
