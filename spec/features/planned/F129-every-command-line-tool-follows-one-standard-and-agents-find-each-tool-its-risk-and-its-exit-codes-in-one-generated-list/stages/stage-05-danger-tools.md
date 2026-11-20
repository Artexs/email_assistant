# F129 stage 05 — Danger tools [risky]

Needs stage 02: `runCli`, `cli-pending.json` group `danger`, the standard test. Needs stage 04: helpers in `scripts/lib/`. May run next to 06–13 (no shared tool file; `cli-pending.json` lines differ).

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D8. Recipe: `docs/cli.md` § Convert a tool. Review: `claude-opus-5-5` before the land.

## Tools

| Command | Risk | Needs | Guard after this stage |
| --- | --- | --- | --- |
| `org:delete` | danger | db | `--confirm <organization name>` (exists), `--dry-run` (new if absent) |
| `org:dsr` | danger | db | `--erase --confirm <address>` (exists); `--find` and `--rule-check` change nothing; `--dry-run` with `--erase` (new if absent) |
| `org:export` | danger | db | none: it changes nothing and writes an age-encrypted file |
| `org:break-glass` | danger | db | `--confirm <organization name>` (new), `--dry-run` (new) |
| `web:two-factor-reset` | danger | db | `--confirm <user id>` (new), `--dry-run` (new) |

`outputNote` for `org:delete` and `org:dsr`: the mailbox and address lines they print today (an existing exception, F106 D17).

## Step 1 — The guard (D8)

- **Goal:** every data-changing danger tool refuses to change data without the exact confirm value, and can show what it would change.
- **Rules:**
  - The confirm check runs after the parse and after the target row is read, before any write, inside no transaction that writes.
  - Missing `--confirm` (and no `--dry-run`) → usage error, exit 2, nothing read beyond the parse.
  - Wrong value → one stderr line `[prefix] refused: confirm does not match`, exit 1, no row changed, no audit row.
  - The organization name compares exactly (case and spaces as stored); the user id compares as a lowercase UUID.
  - `--dry-run` → stdout lines of counts it would change (`would <verb> <n> <thing>`), exit 0, no row changed, no audit row. `--dry-run` with `--confirm` is a usage error.
  - Where a tool already has a confirm shape (`org:delete`, `org:dsr --erase`), keep its flag and text; add only what is missing.
- **Guard check (required):** for each of the four guards, remove the check, run its test, see it fail, restore. List each guard and its failing test in the final message.

## Step 2 — Convert the five tools

- Follow the recipe. Event lines (F103 D26: `org_delete_refused` and the others) stay as they are.
- `process.stdout.write` and `process.stderr.write` become `out.write` / `out.writeErr` with the same bytes.
- Callers to update: `deploy/README.md` runbooks (break-glass, two-factor reset, delete, dsr), `docs/capabilities/` pages, `docs/known-alerts.md`, the operator routes that call the same service functions (no change expected: the guard lives in the CLI, the service functions keep their signatures).

## Test (integration, `apps/server/test/integration/*-cli.test.ts`; spawn the tool)

1. `org:break-glass --org-id <org> --user-id <user>` without `--confirm` → exit 2; the member's break-glass state unchanged.
2. Same with `--confirm "Wrong Name"` → exit 1, stderr `refused: confirm does not match`, no audit row.
3. Same with `--confirm "<exact org name>"` → exit 0, state set, one audit row (as today).
4. `org:break-glass … --dry-run` → exit 0, stdout `would set break-glass for 1 member`, no audit row.
5. `web:two-factor-reset --org-id <org> --user-id <user> --confirm <other uuid>` → exit 1, two-factor row unchanged.
6. `web:two-factor-reset … --confirm <USER ID IN CAPITALS>` → exit 0 (UUID compares lowercase).
7. `org:delete --org-id <org> --dry-run` → exit 0, organization row still there.
8. `org:dsr --org-id <org> --address a@example.test --erase --dry-run` → exit 0, no row erased.
9. `org:delete --org-id <org> --dry-run --confirm "<name>"` → exit 2.
10. Bad UUID in `--org-id` for each tool → exit 2 (was 1 or 2).

Existing `*-cli.test.ts` cases that assert exit 1 for bad arguments change to 2; list each changed assert in the final message.

## Out of scope

The service functions' behaviour; the operator web routes; other org tools (stage 06).

## Done when

Steps 1–2 done; the five files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s05` prints `PROOF_OK`.
