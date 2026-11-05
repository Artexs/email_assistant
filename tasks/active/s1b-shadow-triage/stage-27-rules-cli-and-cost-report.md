# s1b-shadow-triage — Stage 27

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 27 — Rules CLI and cost report

- [ ] **27.1 `bun run rules:add` and `rules:list`**
  - Goal: the user can add whitelist, blocklist and VIP rules before S5.
  - Files: create `apps/server/src/scripts/rules.ts`; change root `package.json` (`"rules:add": "bun apps/server/src/scripts/rules.ts add"`, `"rules:list": "bun apps/server/src/scripts/rules.ts list"`).
  - Interfaces: `bun run rules:add --org-id <uuid> [--mailbox-id <uuid>] --pattern <address or domain> --kind whitelist|blocklist|vip`; `bun run rules:list --org-id <uuid> [--mailbox-id <uuid>]`.
  - Decisions: pattern check: an address `local@domain` or a domain (`firma.pl`), no spaces; reject a leading `@` (`@firma.test` would count as an address and never match) and a domain without a dot (`test` would match every `*.test` sender) (stage 1 review, 2026-11-04); stored in lower case (`insertSenderRule`). Validation rule from modules §3.3 ("the owner's own address cannot be a delegate") is for delegates (S4), not for these rules. `rules:list` prints the patterns to stdout through an `out()` helper (they are the user's own settings, not log lines).
  - Test: none beyond the repo tests; manual run on the dev DB.
  - Check: `bun run lint && bun run typecheck`; manual run.
  - Done when: `rules:add` then `rules:list` shows the rule; a duplicate prints "already there".
  - Out of scope: delete or edit of rules (S5 web).

- [ ] **27.2 `bun run triage:cost`**
  - Goal: tokens, latency and cost per mail and per mailbox per month from stored results.
  - Files: create `apps/server/src/scripts/triage-cost.ts`; change root `package.json` (`"triage:cost": "bun apps/server/src/scripts/triage-cost.ts"`).
  - Interfaces: `bun run triage:cost --org-id <uuid> --mailbox-id <uuid> [--days 7] [--mail real|synthetic]` (default `real`).
  - Decisions: `listUsageSince(now − days, { mail })` (step 8.1); per model: mails with an LLM call, mails per day (observed), avg tokens in/out, latency p50/p95, avg cost per mail (`costPerMail`, step 16.1), cost per mailbox per month = avg cost × observed mails per day × 30, and the same at 200 mails per day. Numbers only in the output (stdout through `out()`). The cost uses the paid-tier price (`llmPrices`) although the pilot runs on the free tier; print a line "paid-tier price, source <url>, read <date>" for each model (user answer 3, 2026-11-04). Rows with `model` NULL (blocklist, `triage_error`, `llm_blocked`) are not in `listUsageSince`; the output prints this as one line.
  - Test: none beyond `cost.test.ts`; manual run on the dev DB (`--mail synthetic`).
  - Check: `bun run lint && bun run typecheck`; manual run.
  - Done when: a manual run prints the figures for the dev mailbox.
  - Out of scope: a Telegram cost line.

## Note from the checkpoint 3 group review

- In `triageOne` the `latency_ms` of an error `llm.call` row (`Date.now() - start`) includes the rate-limiter wait; the `ok` row uses `usage.latencyMs`. Do not use error-row latency in the cost report.
