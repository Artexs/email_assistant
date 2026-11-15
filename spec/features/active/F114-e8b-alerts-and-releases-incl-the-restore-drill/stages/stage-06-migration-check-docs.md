# F114 stage 06 — Migration check, release prepare, changelog, checklist, runbook

Part of [`../plan.md`](../plan.md). Decisions P4, P5, D14, D15. Needs stage 05 (the README names its scripts).

## Step 1 — Migration check

- **Files:** `scripts/check-migrations.ts`, `package.json` script `db:check-migrations`, one step in the CI `ci` job (before `db:migrate`).
- **Scope:** files in `db/migrations/` whose timestamp is greater than the constant `CONTRACT_CHECK_AFTER` = the newest migration timestamp at your base. Only the `-- migrate:up` part; `--` comments removed first.
- **Flagged** (case-insensitive, `IF EXISTS` too): `DROP TABLE|COLUMN|TYPE|VIEW|SCHEMA|SEQUENCE|EXTENSION`, `RENAME` (any form), `ALTER COLUMN … TYPE` and `… SET DATA TYPE`, `ALTER COLUMN … SET NOT NULL`, `TRUNCATE`, `REVOKE`; `DROP CONSTRAINT|INDEX|FUNCTION|TRIGGER|POLICY x` unless the same file creates `x` again (a replace); `ADD CONSTRAINT` on a table that the same file does not create (old writers can break).
- **Allowed:** any file with a line `-- contract: v<x.y.z>` (the release that stopped the use). A replace that narrows a CHECK list is not visible to the check: a review rule in `code-patterns.md`.
- **Output:** `<file>:<line> <rule>`, exit 1; none → exit 0.
- **Test** (fixtures in `/tmp/f114-s06/`, cutoff passed as an argument):
  1. `ALTER TABLE a DROP COLUMN b;` → `drop_column`, exit 1.
  2. The same plus `-- contract: v0.2.0` → exit 0.
  3. `DROP INDEX x;` → `drop_index`; with `CREATE INDEX x` in the file → exit 0.
  4. `DROP CONSTRAINT outbox_kind_check` then `ADD CONSTRAINT outbox_kind_check CHECK (…)` → exit 0; the drop alone → `drop_constraint`.
  5. `-- DROP TABLE x` → exit 0.
  6. `DROP TABLE x` under `-- migrate:down` → exit 0.
  7. `ALTER COLUMN b TYPE text` and `ALTER COLUMN b SET DATA TYPE text` → two findings.
  8. `RENAME COLUMN b TO c` → `rename`.
  9. A file at or before the cutoff with `DROP TABLE` → exit 0.
  10. `DROP FUNCTION f` then `CREATE OR REPLACE FUNCTION f` → exit 0.
  11. `ALTER COLUMN b SET NOT NULL` → `set_not_null`.
  12. `TRUNCATE a;` → `truncate`. `ALTER TABLE a ADD CONSTRAINT c CHECK (…)` → `add_constraint`; with `CREATE TABLE a` in the file → exit 0.
  13. The real `db/migrations/` at your base → exit 0.

## Step 2 — `bun run release:prepare <x.y.z>`

- Sets the root `package.json` `version`; in `CHANGELOG.md` moves the items under `## [Unreleased]` to a new `## [x.y.z] - <UTC date>` and leaves an empty `## [Unreleased]`. Prints the next commands (commit, `git tag -a vX.Y.Z`, `git push origin vX.Y.Z`). It runs no git command.
- Refusals (exit 2, no change): not `x.y.z`; not greater than the current version; empty Unreleased.
- New `CHANGELOG.md` (Keep a Changelog, groups Added, Changed, Fixed, Removed, Security). Unreleased: one line per Stage 2 ticket that is on the VPS at your base (from `notes/2026-11-15-vps-deploy-queue.md` and `spec/features/done/`), product words, no ids of people.
- **Test:** 14. With version `0.0.1` and two Unreleased items, `prepare 0.1.0` (fixed date 2026-11-20) → version `0.1.0`, heading `## [0.1.0] - 2026-11-20` with both items, empty Unreleased. 15. `prepare 0.0.1` → exit 2. 16. Empty Unreleased → exit 2.

## Step 3 — Checklist and runbook

- New `docs/release-checklist.md`, in order: CI green on the tagged commit; changelog entry; model or prompt changed → the E2 `eval --sim` holdout report attached (PD-025); sim stack deploy (F113): rebuild `ea-sim` when its files changed; owner-facing changes in the capability pages (PD-009); `release:prepare`, commit, tag, push; `deploy/release.sh <tag>` output ends with `release ok`; 30 min watch: no new `error` events in the log store, `bun run ops:alerts` shows no open alert; on trouble `deploy/rollback.sh`.
- `deploy/README.md`: § Update becomes "Release" (the checklist link and `release.sh`); § Roll back (web panel) and the other per-feature roll-back sections point to `rollback.sh` and keep their own SQL notes; one rule line "every VPS deploy is a release (a patch version is fine)".
- `docs/code-patterns.md` § Migrations: forward-only, expand/contract, `-- contract:` for a contract, a release's migration works with the previous code, a narrowed CHECK is a contract, a broken migration gets a forward fix or a restore.
- `docs/capabilities/operations.md` § Releases.

## Done when

Tests 1–16 pass; CI config runs the check; the Proof of `plan.md` prints `PROOF_OK`.

Out of scope: the first tag and release (09); old migrations.

## Carry-over from stage 05 review

- Runbook: a second `rollback.sh` with no pending state swaps current and previous; a plain `up -d --build` stamps `EA_RELEASE=dev`; the prune removes every `ea-server:pre-*` tag except current and previous (manual pre-<ticket> images go); the checkout is detached after a release or rollback (`git checkout master` first); a failed release needs `rollback.sh` before the next `release.sh` (review-5.md N2).
