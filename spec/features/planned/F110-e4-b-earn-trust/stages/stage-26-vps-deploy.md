# F110 stage 26 — VPS deploy `[risky]`

Part of [`../plan.md`](../plan.md). Needs stages 01–25 landed and the `master` CI run of the last land green.

`[risky]`: the real system. **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job; no other VPS deploy at the same time. Every VPS deploy is a release (refresh 1): follow `docs/release-checklist.md` and `deploy/README.md` § Release. Never a bare `up -d --build` (it stamps `EA_RELEASE=dev`).

## Before

1. The release tag is the first that holds F110 stage 25. `git log --oneline <current release tag>..<new tag>`: another ticket's VPS step in the range goes first, by its runbook.
2. Release checklist steps 1–7: CI green on the tagged commit; `CHANGELOG.md` `[Unreleased]` has one product line per F110 user-visible change (trust report, recommended categories, pause notices, report by mail, quiet hours, why lines, spam line, urgency card, newsletters); `bun run db:check-migrations` passes; `release:prepare`, tag, push.
3. Two F110 migrations (stages 03, 22): new tables, nullable columns, checks. The code of the current release works with them (the contract rule; Q17). The stage 03 file has an expand-only `-- contract:` mark: the checklist rule "that release must be the rollback target" does not apply to it and is no stop (review 2 N6).
4. **Do not change the LLM model, provider, reasoning effort or `OPENAI_BASE_URL` in this release.** The first re-gate run stamps every existing `auto` with the running key (`legacy`, D7); a switch in the same release would stamp the new key without evidence.

## Runbook

1. Write down the rollback target: `current` in `deploy/release-state/state` and the HEAD commit.
2. `deploy/release.sh v<x.y.z>` → last line `release ok v<x.y.z> previous <old>` (backup, disk check, build, `db:migrate`, health and `EA_RELEASE` check are inside). Any other end: go to Rollback.
3. One-off commands run in the `cli` service (`$C run --rm cli bun run …`), never in `server`.
4. Flags stay off in this step.

## Checks

1. `/health` → 200; a server line has `"release":"v<x.y.z>"`.
2. `$C exec server ls evals/results/gate` → the committed gate files (D1).
3. `bash deploy/logs.sh --since 15m --event trust_regate_done` → the line with `run=start` (later `run=job` lines also count 0 paused) has `stamped` ≥ 0, `paused` 0. A `paused` > 0 means a key mismatch at deploy: roll back and report.
4. `psql`: `SELECT count(*) FROM mailbox_settings s, jsonb_each(s.category_policy) e WHERE (e.value->>'auto')::boolean AND NOT (e.value ? 'grant')` → `0` (every `auto` category stamped; review 1 N15).
5. Watch 30 minutes (checklist step 9): sync lines for the pilot mailbox; no `error` event in the log store or `deploy/logs.sh --level error`; `bun run ops:alerts` (in `cli`) shows no open alert.
6. Owner checkpoint U2 (not a stop; plan default): `org:flag --flag trust_ladder --on` for the pilot org; `bun run trust:history-check --org-id … --mailbox-id …` (both in `cli`); after ≤ 60 min the check is `done` or `no_result` (`psql` on `history_checks`), `cost_usd` ≤ 0.25, and the report page loads through Tailscale.
7. The other flags (`why_lines`, `spam_review_line`, `user_quiet_hours`, `report_mail`, `urgency_editor`, `panel_review`, `bulk_unsubscribe`) stay off until the owner asks; list them in the report.

## Rollback

When the release fails or check 1, 3 or 5 fails:

0. Before `deploy/rollback.sh` starts the old image: `UPDATE outbox SET status = 'failed', error_code = 'outdated' WHERE kind IN ('trust_report_ready', 'autonomy_paused') AND status = 'pending'`; delete pending outbox rows with `channel = 'mail'` (the old sender has no mail path).
1. `deploy/rollback.sh` → last line `rollback ok <target>` (no rebuild, no DB change).
2. Never `db:rollback`. The old code ignores the new tables and the `grant` key (the pre-F110 `categoryPolicySchema` is a non-strict zod object: it drops `grant` on read; a later F110 start treats such `auto` as `legacy` again).
3. Report the failing check; the coordinator decides on reverts and a forward-fix patch release.

## After

- Write the result into `plan.md` § Log (date, commit, check outputs, no ids); `limen ticket done`.
- U2 to the owner in one line: "On the phone (Tailscale on), open `/report`, read the result, and tap 'Turn on recommended' only if you agree."
