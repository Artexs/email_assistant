# F095 stage 06 — Pages `digest-and-notices.md` and `web-panel.md`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4–D7, D19. Read "Rules for every stage" and the method box of [`stage-03-cap-sync-triage.md`](stage-03-cap-sync-triage.md) ("How to write a page", items 1–8) first.

Two pages: what reaches the user on Telegram (and the operator), and the web panel. Three steps. Docs only.

F088 (notices as facts) may still be active when this stage runs. Describe the code at your base commit; when `outbox` still changes in an open F088 stage, write that in "Limits" with the folder name.

## Step 1 — `docs/capabilities/digest-and-notices.md` ("Digest and notices")

- **Goal:** an agent knows every message the system sends to a person (digest, notices, approvals, results, operator events), when, and through which code path.
- **Seams:** `apps/server/src/modules/channels/` (`index.ts`, `digest-job.ts`, `notice-queue.ts`, `notices/` (one file per detector, `registry.test.ts`), `sender.ts`, `operator.ts`, `commands.ts`, `callbacks.ts`, `linking.ts`, `texts.ts`, `telegram/`), `packages/core/src/notices/` (kinds, views, renderers), `packages/core/src/digest/`, `apps/server/src/modules/reports/digest.ts`, scripts `telegram-check.ts`, `telegram-link.ts`, `telegram-unlink.ts`, `digest-times.ts`; ADR 0005.
- **Must cover:** chat linking (`/start` token, `bun run telegram:link`), the digest job (times per member, organization time zone, missed slot within 6 h, sections and buttons), the notice kinds (read the registry; one row each: kind, trigger, who gets it), the outbox sender (rate, errors, `expired` after 24 h), quiet hours, the commands (`/digest /status /pause /resume /help`, from `commands.ts`), the callback prefixes (from `packages/core/src/digest/callback.ts`), operator notices (`OPERATOR_TELEGRAM_CHAT_ID`, `OPERATOR_CONTACT`), notices as facts (view, renderer, locale; as far as the code at the base has it).
- **Moves from `architecture.md`:** §8 bullets: the "S2 jobs" sentences of the Scheduler bullet (`channels.notifier` and `channels.digest` detail; the job names stay in the Scheduler list), "Notices (S2)", "Operator notices (S6a)" → "Rules". The "Liveness" bullet stays in §8 (D5); its sentence "A Telegram admin notice goes out when the last good sync is older than 30 min." may stay there.
- **Limits (at least):** Telegram only; no mail channel for digest and report (E4-B F110, ADR 0022 proposed); no push (E9b F118); English texts only (E7-T1 F098); the "Already saved" picker fix (F030, by folder name, if still open at your base).
- **Decisions:** ADR 0005, 0022 (proposed, Limits), 0032 (proposed, Limits); PD-033.
- **Tests:** `apps/server/test/integration/channels-notices.test.ts`, `channels-outbox.test.ts`, `channels-sender.test.ts`, `channels-digest-job.test.ts`, `channels-callbacks.test.ts`, `channels-commands.test.ts`, `channels-linking.test.ts`, `channels-operator.test.ts`, `apps/server/src/modules/channels/notices/registry.test.ts`, the tests of `packages/core/src/digest/` and `packages/core/src/notices/`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 2 — `docs/capabilities/web-panel.md` ("Web panel")

- **Goal:** an agent knows what the panel offers, how a user signs in, which `/api` routes exist and how the panel is reached.
- **Seams:** `apps/web/src/islands/` (one island per page), `apps/web/src/pages/`, `apps/web/src/lib/api.ts`, `apps/web/src/i18n/en.ts`, `apps/server/src/web.ts` (route mounts), the `routes.ts` file of each module, `apps/server/src/platform/http.ts` (`requireTenant`, `requireOwner`, `requireOperator`), `apps/server/src/platform/auth.ts`, `auth-lockout.ts`, `pwned.ts`; `docs/modules.md` §4 (pages); `docs/architecture.md` §7 (auth and web security rules stay there; link them); `deploy/README.md` § Web panel; ADR 0016, 0017.
- **Must cover:** pages and what each does (one row per island), sign-in with Better Auth and the login hardening that is in the code at your base (lockout, leaked-password check, terms, session list: check each; F082 may still be active), invite (`bun run web:invite`, `bun run org:invite`), the `/api` route groups (one row per mounted router in `web.ts`), the operator route (`/api/operator/*`, `OPERATOR_USER_IDS`), reach by Tailscale Serve only, the static build (`WEB_DIST`).
- **Moves from `architecture.md`:** nothing (the panel rules are in §7 and §10, which stay). Link them.
- **Limits (at least):** no approvals, delegates or delegations pages (E4-A F102); English only (E7-T1 F098); no live updates, polling every 30 s (F055, by folder name); Astro version (Panel to Astro 7, F101); no TOTP or SSO (E7-T6 F105, E7-T7 F119).
- **Decisions:** ADR 0016, 0017, 0023 (proposed, Limits), 0026 (proposed, Limits), 0027.
- **Tests:** the route tests in `apps/server/src/` and `apps/server/test/integration/` that cover `/api` (find them with `grep -rln "/api/" apps/server/test/integration apps/server/src --include=*.test.ts`), `apps/web/e2e/` (folder), `apps/web/src/i18n/en.test.ts`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 3 — Check

- **Check:** `grep -n "Moved to \[docs/capabilities/digest-and-notices.md" docs/architecture.md` → the §8 lines of step 1. `bun test apps/server/src/capability-map.test.ts` → 0 fail. The README index has 7 rows (2 + 1 + 2 + 2).
- **Done when:** the checks hold.

## Review focus

The notice table matches the detector registry and `packages/core/src/notices/kinds.ts` one to one. The route table matches the mounts in `web.ts`. Ten claims against the code in total.

## Done when

- Steps 1–3 hold.
- The Proof command of `plan.md` (`/tmp/f095-s06`, files: `docs/capabilities/digest-and-notices.md docs/capabilities/web-panel.md docs/capabilities/README.md docs/architecture.md` plus each other `.md` file whose references you changed) prints `PROOF_OK`.
