# F129 stage 05 — Danger tools [risky]

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `danger`, the standard test. Needs stage 04: helpers in `scripts/lib/`. May run next to 06–15 (no shared tool file; `cli-pending.json` lines differ).

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D8. Recipe: `docs/cli.md` § Convert a tool. Review: `claude-opus-5-5` before the land.

## Tools

| Command | Risk | Needs | Confirm after this stage |
| --- | --- | --- | --- |
| `org:delete` | danger | db | `--confirm <organization name>` (exists) |
| `org:dsr` | danger | db | `--erase --confirm <address>` (exists); `--find`, `--rule-check`: none |
| `org:export` | danger | db | none: changes nothing, writes an age-encrypted file |
| `org:break-glass` | danger | db | set (`--user-id`) and `--clear`: `--confirm <organization name>` (new); list mode (no `--user-id`, no `--clear`): none |
| `web:two-factor-reset` | danger | db | `--confirm <organization name>` (new) |

`outputNote` for `org:delete` and `org:dsr`: the mailbox and address lines they print today (F106 D17).

## Step 1 — The confirm guard (D8)

- **Goal:** no data-changing danger run changes data without the organization's name typed by the operator.
- **Rules:**
  - Compare with `orgNameMatches` from `@ea/core` (trim, NFC, case-insensitive), the rule `org:delete` and the web delete use. Do not write a second compare.
  - Missing `--confirm` in a changing mode → `UsageError`, exit 2, before the DB is opened.
  - Wrong value → exit 1, nothing changed, no audit row. Text: `[prefix] refused: confirm does not match`, except `org:delete`, which keeps its text and its `org_delete_refused name_mismatch` event line as today.
  - The check runs after the organization row is read and before the first write; it reads the name with `getOrganization` from the `tenancy` index (no repository call, ADR 0023).
  - No new `--dry-run` (D8). An existing `--dry-run` or find mode keeps its behaviour.
- **Callers:** `apps/web/e2e/tests/two-factor.spec.ts` runs `org-break-glass.ts --org-id … --user-id …` and `--clear` by path: add `--confirm <the seeded org name>`. Grep `org-break-glass`, `web-two-factor-reset`, `org:break-glass`, `web:two-factor-reset` in `apps/`, `deploy/README.md`, `docs/`.
- **Guard check (required):** for `org:break-glass` set, `--clear` and `web:two-factor-reset`, remove the check, run its test, see it fail, restore. List each guard and its failing test in the final message.

## Step 2 — Convert the five tools

- Follow the recipe. Event lines (F103 D26) stay. `process.stdout.write`/`stderr.write` become `out.write`/`out.writeErr` with the same bytes.
- Callers: `deploy/README.md` runbooks, `docs/capabilities/` pages, `docs/known-alerts.md`.

## Test (integration, spawn the tool)

1. `org:break-glass --org-id <org> --user-id <owner>` without `--confirm` → exit 2; state unchanged; no audit row.
2. Same with `--confirm "Wrong Name"` → exit 1, `refused: confirm does not match`, no audit row.
3. Same with `--confirm "  <org name in capitals>  "` → exit 0, state set, one audit row (as today).
4. `org:break-glass --org-id <org> --clear` without `--confirm` → exit 2; with the right name → exit 0.
5. `org:break-glass --org-id <org>` (list) → exit 0 without `--confirm`; no row changed.
6. `web:two-factor-reset --org-id <org> --user-id <user>` without `--confirm` → exit 2; with a wrong name → exit 1, two-factor row unchanged, no audit row; with the right name → exit 0.
7. `org:dsr --org-id <org> --address a@example.test --erase --confirm b@example.test` → exit 1, no row erased.
8. Each tool with `--org-id not-a-uuid` → exit 2.
9. An owner refused today (`not_owner`, `no_two_factor`) with the right confirm → the same refusal and code as today.

Existing `*-cli.test.ts` asserts of exit 1 for bad arguments change to 2; list each in the final message.

## Out of scope

Service function behaviour; operator web routes; other org tools (stage 06); new dry-run paths.

## Done when

Steps 1–2 done; the five files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s05` and `&& bun run test:e2e > /tmp/f129-s05/e2e.log 2>&1` before `echo PROOF_OK` prints `PROOF_OK`, `test:e2e` under the lock rule `CLAUDE.md` states at HEAD.
