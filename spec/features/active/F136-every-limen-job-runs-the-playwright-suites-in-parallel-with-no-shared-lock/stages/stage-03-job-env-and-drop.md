# F136 stage 03 — Port block picker and DB drop of the sibling

Needs stage 01: `apps/server/src/scripts/e2e-job-env-args.ts` (`E2E_DEFAULT_PORTS`, `portFromEnv`). Needs stage 02 only for the key name `E2E_MAIL_TAG` (fixed in the plan), so it may run next to 02. Reads `apps/server/src/scripts/db-worktree.ts` at HEAD.

Part of [`../plan.md`](../plan.md). Decisions D2, D5, D6.

## Step 1 — Pick a free port block

**Files.** `apps/server/src/scripts/e2e-job-env-args.ts` (pure part), new CLI `apps/server/src/scripts/e2e-job-env.ts`, and new unit tests.

**Interfaces.**
- `portBlock(slot: number): { app: number; telegram: number; docs: number }` returns `20000 + 10·slot` and the next two ports.
- `jobHash(jobName: string): string` returns the tail after the last `-` when it is 1–16 hex characters, else the first 8 hex characters of the SHA-1 of the name (review N9). The CLI uses it for the slot and the tag.
- `firstSlot(hash: string): number` returns `parseInt(hash, 16) % 1000`. A hash that is not 1–16 hex characters throws.
- `pickPortSlot(hash: string, isTaken: (slot: number) => boolean): number | null` probes linearly from `firstSlot`, wraps after 999, and returns `null` when all 1000 slots are taken.
- `claimedSlots(envTexts: string[]): Set<number>` reads only `E2E_PORT=` lines. The slot is `(port − 20000) / 10` when that is an integer 0–999; anything else is no claim.
- CLI `bun apps/server/src/scripts/e2e-job-env.ts --job-name <date>-<hash>` prints exactly four lines: `E2E_PORT=…`, `E2E_TELEGRAM_PORT=…`, `DOCS_TEST_PORT=…`, `E2E_MAIL_TAG=<hash>`. It reads the `.env` of every other worktree (`git worktree list --porcelain`), keeps only the `E2E_PORT` lines, and never prints any other line. A slot is also taken when a bind test on 127.0.0.1 fails for one of its ports. Exit 0 when it prints. Exit 1 with `no free e2e port block` when all slots are taken. Exit 2 on bad arguments. Output goes through `createCliOutput`.
- The CLI does not lock. Prepare (stage 04) holds the flock around the call and the `.env` write.

**Test.**
1. `firstSlot("1ac5ae68")` → 856; `portBlock(856)` → `{ app: 28560, telegram: 28561, docs: 28562 }`.
2. `pickPortSlot("1ac5ae68", () => false)` → 856.
3. `pickPortSlot("1ac5ae68", (s) => s === 856)` → 857.
4. `pickPortSlot("000003e7", (s) => s === 999)` → 0 (wrap).
5. `pickPortSlot("1ac5ae68", () => true)` → `null`.
6. `claimedSlots(["A=1\nE2E_PORT=28560\n# E2E_PORT=20000\n", "E2E_PORT=8081\n", "E2E_PORT=28565\n"])` → `{856}`.
7. `firstSlot("xyz")` throws; `jobHash("2026-11-19-1ac5ae68")` → `"1ac5ae68"`; `jobHash("2026-11-19-odd-name")` → 8 hex characters, the same on each call.
8. CLI integration (new file): a temp git repo with two worktrees. The other worktree's `.env` holds `E2E_PORT=28560` and `SECRET=do-not-print`. The CLI run for `--job-name 2026-11-19-1ac5ae68` in the first worktree prints `E2E_PORT=28570`, three more lines, and no `do-not-print`. If those ports are busy, expect the first free slot after 856; never skip.

## Step 2 — `db:worktree --drop` drops the sibling too

**Files.** `apps/server/src/scripts/db-worktree.ts` and, if a pure helper fits, `db-worktree-args.ts`. New integration test file.

**Decisions.**
- `db:worktree <name> --drop` handles the base database (`email_assistant_<name>`) and its sibling (`email_assistant_<name>_e2e`, from `worktreeDatabaseName(`${name}-e2e`)`). When the sibling name is too long (null), only the base counts.
- It reads both marks first. A database that exists without the `db:worktree` mark refuses the whole command: exit 1, nothing dropped. A missing base prints `no database …` as today. A missing sibling prints nothing, so the stdout assertions of `cli-streams-other.test.ts` still hold (review B2); that file is not edited.
- Order: sibling, then base. An in-use error (`55006`) on either stops the command with exit 1 and names the database.
- Create does not change.
- Update the usage text: "--drop removes it and its -e2e sibling".

**Test (integration, new file, against the dev Postgres like the existing db-worktree tests).**
9. Create `f136t-<random>` and `f136t-<random>-e2e` with the script, then `--drop f136t-<random>`: both are gone, exit 0.
10. Only the base exists: `--drop` exits 0 and drops it.
11. The sibling exists without the mark (create it with a plain `CREATE DATABASE`): `--drop` exits 1, and both databases still exist. Clean them up in `afterAll` as postgres.
12. Unit (pure helper): the sibling of `e2e` is `email_assistant_e2e_e2e`. Never run `--drop e2e` in a test.

**Out of scope.** The prepare script (stage 04), the docs.

## Done when

Tests 1–12 pass. The plain Proof chain of `plan.md` (no Playwright link).
