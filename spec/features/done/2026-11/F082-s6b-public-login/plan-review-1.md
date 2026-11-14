# F082 plan review 1 (cold review, scout job `2026-11-12-f082-plan-review-39de5ac0`)

Filed whole from the job log. Leads, not facts; what the plan changed is in `plan.md` § "Cold review".

```text
Packet: F082 plan cold review — which stage lets a bug reach the user
Base: 2e7d800
Verified: `bun -e 'z.email().safeParse(" a@x.test").success'` -> `false` (Better Auth rejects the input with 400 `INVALID_EMAIL`; the planned lock hook would trim it and answer 401). Also `git status --short` -> empty.
Unknowns:
- I did not run any stage, and the Better Auth hook behaviour (F2) is read from `dispatch.mjs`, not re-probed. The `/tmp/s6b-probe` files exist on this machine but are not in the repo.
- I did not check the IPv6-first DNS order of `dns.lookup` on the VPS (guessed). The pilot host `poczta.interia.pl` has an IPv4 address only (`getent ahosts`).
- I did not check how many Playwright specs touch `/api/me` besides the ones listed.

1. **MAJOR — stage 5 leaks the lock state (stage 5, L13).**
   - Rule: `stage-05-lockout.md:74` has the `before` hook run `String(ctx.body?.email ?? "").trim().toLowerCase()`, look up the user, and throw 401 when the user is locked. The plan then calls the answer the same as a wrong password (`plan.md:96`, "Done when" `plan.md:145`).
   - Code: the sign-in endpoint answers before any lookup in two cases (`better-auth/dist/api/routes/sign-in.mjs:315-316`).
     - Bad email: it does not trim, and `z.email()` rejects `" a@x.test"`, so the answer is 400 `INVALID_EMAIL`.
     - Password over 128 characters: 400 `PASSWORD_TOO_LONG` (`utils/password.mjs:10-14`).
   - Effect: for a locked user the hook answers 401 on those inputs. An attacker learns that the address exists and is locked. No test covers it (tests 1–12).
   - Missing rule: the hook must reproduce the endpoint's input checks, or skip when they would fail.
   - Observed.

2. **MAJOR — stage 9 is wrong about the scripts, and its test cannot pass as written.**
   - Wrong fact: `plan.md:67` and the list at `stage-09:16` say `mailbox-probe-move` and `mailbox-probe-send` call `loadConfig`. They do not: `mailbox-probe-move.ts:60` and `mailbox-probe-send.ts:89` say "Read here, not through loadConfig". `stage-09:44` ("right after its `loadConfig()`") and `mailAllowLocal(config)` do not work for them.
   - Test rule: `stage-09:45` checks only files that hold `loadConfig(` and `"../modules/mail"`, but wants the 12 listed files checked. Run against the base, it checks 8 scripts plus `main.ts`.
     - `job-run.ts` has `loadConfig(` but imports `../composition`, not `../modules/mail`. It builds `committerDeps`, which sends mail.
     - `testmail-target.ts` matches.
     - The two probe scripts have no `loadConfig(`.
   - A worker must guess here. `job-run` stays unguarded, or the test fails.
   - Observed (grep of `scripts/*.ts`).

3. **MAJOR — stage 9 is too big for one job.**
   - Scope: about 45 files.
     - guard wiring in imap, smtp and `probe-send`
     - config key swap
     - `bunfig.toml` and preload
     - 12 scripts
     - the static test
     - env edits in 16 spawn tests (`grep -l "Bun.spawn" apps/server/test/integration` → 16)
     - the e2e env
     - a new integration test
   - Proof: a full chain plus `web:build` and Playwright, with the 90-minute default timeout (`limen spawn` in `plan.md:240` sets none).
   - Suggested split: 9a wiring, config, preload; 9b scripts and the static test. Stages 3 and 7 are also large; they touch every `createAuth` caller.
   - Guessed.

4. **MINOR — wrong or stale facts and small conflicts (each with file:line).**
   - F3 `plan.md:60` says the reset route "does not lower-case the address". Wrong: `internal-adapter.mjs:620,626-627` lower-cases both sides. Harmless.
   - F8/F9 line references (`plan.md:65-66`) do not match nodemailer 10.3.1. It lives at `dist/cjs/smtp-connection/index.js:176,317` and `dist/cjs/shared/index.js:135`. The behaviour itself holds.
   - F10 `plan.md:67` lists `auth.test.ts`, `web-schema.test.ts` and `web-http.test.ts` as `resetPassword` callers. They are not.
   - `plan.md:125` (L27) says `MAIL_ALLOW_LOCAL_HOSTS` defaults to `false` with `?? "false"`. `stage-09:36` says no default. Stage 9 is the one that works.
   - `stage-13:80` writes `t(\`browser*${device.browser}\`)`; the keys are `browser_edge` and so on. The `*` is a typo.
   - `plan.md:228` omits `[risky]` on stage 13, but `plan.md:201` reviews it.
   - `stage-15:` `git mv tasks/planned/s6b-public-login.md tasks/done/` fails because `tasks/done` does not exist.
   - Stage 2 test 6 and stage 4 tests hardcode GreenMail ports 3025/3143. Existing tests read `TEST_SMTP_PORT` and `TEST_IMAP_PORT`.
   - `stage-02` has a 15 s outer race and a 15 s nodemailer timeout. The code can be `TIMEOUT` or `ETIMEDOUT`, so the notice key (user + code + day) may split.
   - Stage 7 has no named `onTermsAccepted` for `e2e-seed`. If it is a no-op, stage 12 specs show the dialog to every seeded user. 12.2 test 1 catches this later.
   - Stage 7 changes `SetupPage` but runs no Playwright. `auth.spec` first runs at stage 10.
   - Stage 7 greps `resetPassword`. It misses tests that POST `/reset-password` through `handler`, such as `web-pwned.test.ts`. The Proof run finds them.
   - Stage 3 test 8 expects 404 with `...process.env`. A dev `.env` with `AUTH_SMTP_*` turns it red.
   - `docs/known-alerts.md` is not in stage 14. Line 186 there is stale after S6b.
   - `webDeps().close()` waits up to 15 s for mail tasks, after the 30 s job wait and 10 s Telegram wait in `main.ts:250-276`. The sum is over the 45 s grace.
   - Guessed, except where a line is cited.

5. **MINOR/QUESTION — design gaps no rule covers.**
   - Stage 8 (`stage-08:38`, step 7) pins only `addresses[0]`. A multi-address or IPv6-first host with a dead first address fails every sync, where `net.connect` used to fall back. Prefer IPv4 first or try all addresses. Guessed.
   - A blocked host shows only as `sync <id> failed: host not allowed` (`jobs.ts:85`). There is no notice or status change.
   - Question: a user can lock any account again every 15 minutes by wrong passwords, and the sender is off on the VPS. Is that accepted (D11)? Each lock also writes one audit row.
   - Question: `/list-sessions` stays in `AUTH_ALLOWED_PATHS` (`auth.ts:38`) and returns tokens. Stage 3 keeps 8 entries. Remove it when stage 13 adds its own route?
   - Question: terms are enforced only by the UI for existing users. The API and Telegram keep working until the user accepts.
   - Question: `/change-password` has no lockout. A stolen session can guess the current password at 5 per minute.

Checks:
- The proof chain (lint, typecheck, `test:unit`, `test:int`) covers types, units and GreenMail. It misses these:
  - the two input-validation sign-in cases above (tests 1–12 never send an over-length password or a padded email);
  - IPv6 or multi-address DNS ordering;
  - a real TLS connect to a pinned IP (stage 15.3 only);
  - `AUTH_SMTP_*` leaking from a dev `.env` into `web-http.test.ts`.
- Stage 5 test 9, the timing median, is flaky by design; the plan accepts 3 runs in a row.
```
