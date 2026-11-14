# F117 plan — E9a Mailbox OAuth

> **Status 2026-11-15 — planned.** Plan base: 09789b10. 21 stages; cold review: § Cold review.

**A gap or a deviation is a question in the final message, not a choice.**

## Input

- Owner, 2026-11-13, E9 decisions 1–12: "Okay default." (PD-085–PD-095; `docs/product/stage-2/epics/E09-reach.md` § Discovery). Detail: `E09-discovery-notes.md` §5–§6; ADR 0031; architecture review §3.7.
- Coordinator, 2026-11-14: "Stage 1 is the Microsoft 365 spike (owner has to provide one Microsoft 365 Business Basic seat: plan the spike so it stops with a clear owner step and a default, PD-086, PD-087)." "Owner checkpoints and owner steps are not a stop: use plan defaults."
- Defaults for new small questions: `questions.md` Q1–Q11.

### Decisions

- **D1 Order.** The OAuth core (stages 03–13) builds before the spike result: the Graph read fallback of PD-086 reuses it. Rejected: wait for U1.
- **D2 Schema** (stage 03): `secret_kind` gains `oauth`; `mailboxes.send_via`, `oauth_provider`, `auth_reason`; table `mailbox_oauth_states`.
- **D3 Stored secret.** `OAuthSecret = { v: 1; provider; refreshToken; tenantId: string | null; scopes: string[] }`, JSON, `SecretBox`, AAD `mailbox:<id>` (ADR 0009). No access token in the DB.
- **D4 Auth material** (stage 04): `AuthMaterial = { kind: "password"; password } | { kind: "oauth"; accessToken }` replaces `password` in the IMAP and SMTP options. Rejected: a second adapter.
- **D5 Sender choice** (stage 05): `send_via` picks the sender. Every Microsoft mailbox uses `graph`, also when SMTP AUTH is on (Q5). Google: `smtp` with XOAUTH2.
- **D6 Provider registry** `mailOAuthProviders` (stage 06): URLs, scopes and hosts are constants. Tests inject a replacement (fake token server, GreenMail, fake Graph); no env key holds a URL.
- **D7 Config.** `MAIL_OAUTH_{MICROSOFT,GOOGLE}_CLIENT_{ID,SECRET}`. "Configured" = both keys and `WEB_BASE_URL`; one key alone fails the config check.
- **D8 Flags** `mail_oauth_microsoft`, `mail_oauth_google` (E9a, default off, remove by 2027-06-01) gate a new connect only; Reconnect and existing mailboxes work with the flag off (Q2).
- **D9 Flow** (stages 07–09): authorization code with PKCE S256; owner only; the DB keeps the SHA-256 of `state` and the encrypted verifier; 10 minutes; single use, consumed in its own commit before the code redeem; bound to user, organization, provider and (Reconnect) mailbox.
- **D10 Routes.** `POST /api/mailboxes/oauth/:provider/start` → `{ url }`; `GET …/:provider/callback` → `303 /mailboxes?oauth=<code>`; `GET /api/mailboxes/oauth/options`; `GET …/microsoft/admin-consent`.
- **D11 Result codes**: the `OAuthRefusalCode` union of stage 08 plus `connected`, `reconnected`. A refusal stores nothing.
- **D12 Identity** (stage 08): the ID token comes from the token endpoint over TLS, so the code checks `aud`, `exp`, `iss`, not the signature (OIDC Core §3.1.3.7 rule 6; Q8). Google needs `email_verified`. Microsoft address claim: spike M12 (default `email`, else `preferred_username`).
- **D13 Reconnect** (stage 09): same address or `oauth_wrong_account`; `auth_error`, `host_blocked` → `active`; `paused` stays. A password mailbox cannot switch to OAuth (Q3).
- **D14 Refresh** (stage 10): per-mailbox advisory lock in its own transaction on the pool, never the caller's; a rotated refresh token saved in that transaction; a process cache of access tokens while 5 minutes or more remain (Q1).
- **D15 Reasons** `AuthErrorReason` = `oauth_expired` | `oauth_revoked` | `admin_consent_required` | `protocol_disabled` (ADR 0031 point 6), carried as `reason` on `MailAuthError` and `SmtpSendError`. Password mailboxes keep `auth_reason` NULL.
- **D16 Operator faults** (`invalid_client`, not configured, 5xx, timeout): soft error, log line, same status.
- **D17 Error maps**: token endpoint in stage 06, IMAP login in stage 10, Graph in stage 13.
- **D18 Secrets.** No token, code, `state`, verifier, ID token, client secret or provider `error_description` in a log line, error text, audit row, URL, snapshot or stdout. Log provider codes only. Each server stage that touches them has a canary test.
- **D19 Remove** (stage 12): Google revoke after the delete commits, best effort; Microsoft text points to My Apps; an organization delete revokes nothing (Q6).
- **D20 Smoke** (stage 20): seed through the stored secret; 20 synthetic cases; each `From` becomes an owner plus address (Q7, Q9).
- **D21 Exit.** CI: GreenMail, fakes; real: the provider smoke (PD-091).

## Facts checked

- `imapflow` 1.7.8 sends `AUTHENTICATE` with `auth.accessToken` (`imap-flow.js:1957`); it maps `Sent Items`, `Deleted Items`, `Junk Email` by name (`lib/special-use.js`). Read 2026-11-15.
- `nodemailer` 10.3.1 `SMTPConnection.login` uses XOAUTH2 with `auth.oauth2` (`dist/cjs/smtp-connection/index.js:530–542`). Read 2026-11-15.
- GreenMail 2.1.15 (auth off) offers `AUTH=XOAUTH2` on IMAP and SMTP (`notes/2026-11-03-greenmail-facts.md`).
- R1–R7, R10: `notes/2026-11-13-mail-oauth-and-push-facts.md`.
- RLS, export-map and catalog tests list every table (plan base).

## Not verified

- Every row of stage 01 (M1–M14, P1, G1–G7): owner step U1, report in stage 02.
- Graph `sendMail` size limit (default 3 MB raw): row M10.
- GreenMail XOAUTH2 with auth off takes any token: stage 04 test 3.

## Done when

1. New Microsoft and Google mailboxes connect through the fake token server and sync from GreenMail [06–09].
2. Every error-map row gives its status and reason; operator faults change no status [06, 10, 11].
3. Reconnect keeps the mailbox id and its mail; a wrong account changes nothing [09].
4. The `MailSender` contract suite passes for the fake, SMTP and Graph senders [05, 13].
5. Remove revokes a Google token; the text fits the secret kind [12, 18].
6. D18 canaries pass [04–13, 20].
7. Panel texts in pl and en [11, 12, 15–18]; docs and ADR 0031 `accepted` [19].
8. Provider smoke on both real test mailboxes: connect, 20 cases in assist, sends only to the owner, revoke and Reconnect keep history [21].

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, `ticket.md`, this file and your stage file. Build only your stage. Format only your files.
- D18 holds. Test addresses end in `@x.test`; no tailnet name, tenant id or real address in a file.
- Only stage 03 adds a migration. No stage changes `bun.lock`. Need one: stop and ask.
- A changed type: fix every caller and fake in the stage.
- New user texts: en and pl, word for word from the stage file.
- `git add <paths>`, never `-A`; review `git diff --staged`.

## Proof

Server stages, NN = stage number:

```
mkdir -p /tmp/f117-sNN && bun run lint > /tmp/f117-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f117-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f117-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f117-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (15–18): add `&& bun run web:build > /tmp/f117-sNN/web.log 2>&1` before `echo`. Stages 02 and 21: their stage file. One bash call after the last commit.

## Owner steps and gates

- **U1 (before stage 02; money, secrets):** stage 01 § Owner runbook. The coordinator commits the result files (the probe refuses secrets) and spawns stage 02. Stages 03–13, 16, 20 do not wait.
- **G1 (after stage 02):** M3 FAIL → hold stages 14, 17 and the Microsoft half of 21; ask the owner (PD-086 fallback, about +15 stages). G2 FAIL → hold stage 15 and the Gmail half of 21 (PD-087). Other FAILs → a refresh job for the stages that `spike.md` names. All PASS → go.
- **U2 (stage 21; secrets, browser):** stage 21 § Owner runbook.
- After stage 03 lands: `bun run db:migrate` (main checkout).

## Review

Review job before the land (`claude-opus-5-5`): stages 01, 03, 04, 06–13, 15–18 (auth, migration, sending, Polish text).

## Stages

- 01 [Spike kit](stages/stage-01-spike-kit.md) `[risky]` real system
- 02 [Spike report](stages/stage-02-spike-report.md): needs 01, U1
- 03 [Migration](stages/stage-03-migration.md) `[risky]` migration
- 04 [Auth material, XOAUTH2](stages/stage-04-auth-material.md) `[risky]` auth: needs 03
- 05 [Sender factory, contract suite](stages/stage-05-sender-factory.md): needs 04
- 06 [Providers, config, token client](stages/stage-06-oauth-client.md) `[risky]` auth: needs 03
- 07 [State, PKCE, start](stages/stage-07-start.md) `[risky]` security: needs 06
- 08 [Callback check](stages/stage-08-callback.md) `[risky]` auth: needs 07
- 09 [Callback route, Connect, Reconnect](stages/stage-09-connect-reconnect.md) `[risky]` tenant data: needs 04, 08
- 10 [Refresh](stages/stage-10-refresh.md) `[risky]` data integrity: needs 05, 09
- 11 [Reasons and notices](stages/stage-11-reasons.md): needs 10
- 12 [Remove](stages/stage-12-remove.md): needs 10
- 13 [Graph sender](stages/stage-13-graph-sender.md) `[risky]` sending: needs 05, 06
- 14 [Microsoft, admin consent](stages/stage-14-microsoft.md): needs 02, G1, 10, 13
- 15 [Gmail](stages/stage-15-gmail.md): needs 02, G1, 10
- 16 [Panel: connect](stages/stage-16-web-connect.md): needs 09
- 17 [Panel: admin consent](stages/stage-17-web-admin-consent.md): needs 14, 16
- 18 [Panel: reconnect, remove](stages/stage-18-web-reconnect.md): needs 11, 12, 17
- 19 [Docs](stages/stage-19-docs.md): needs 15, 18
- 20 [Operator tools, smoke seed](stages/stage-20-smoke-tool.md): needs 10
- 21 [Real smoke, VPS](stages/stage-21-real-smoke.md) `[risky]` real system: needs 19, 20, U2

Parallel: 06–08 ∥ 04–05; 13 ∥ 07–12; 12 ∥ 11; 16 ∥ 10–13; 20 ∥ 11–18.

## How to run (coordinator)

1. Before stage 03: `scripts/plan-drift.sh spec/features/<lane>/F117-e9a-mailbox-oauth 09789b10` (exit 1 → refresh job).
2. Spawn each stage (01–20) with the worker command of `spec/build.md` TRACK, label `F117-sNN <slug> · F117`, task: "Implement F117 stage NN. Read spec/features/active/F117-e9a-mailbox-oauth/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: plan.md § Proof (/tmp/f117-sNN). List as proven only what a saved log shows."
3. Review per § Review; `limen land <id> --yes --keep-open`; drop the job DB.

## Planning progress

Stages 01–21 `[written]`. `wc -w`: plan 1,500; stages 692, 326, 612, 449, 573, 685, 662, 539, 693, 699, 635, 499, 612, 497, 554, 597, 511, 506, 467, 446, 554.

## Cold review

Not run yet.

## Log

- 2026-11-15: planned at 09789b10.
