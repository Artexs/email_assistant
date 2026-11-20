# F143 stage 11 — e2e seed steps by area

Needs: nothing. Reads `SIZE_EXCEPTIONS` of stage 01 only if it exists at `HEAD`. May run next to every other stage (it imports names from `./e2e-seed-args`, which stage 10 keeps); not next to an open F121 stage 09 or an F151 stage (they edit the seed). Changes `layers.json` (stage 03 does too: merge `master`, re-prove).
Part of [`../plan.md`](../plan.md).

## Goal

`apps/server/src/scripts/e2e-seed.ts` (1,259 lines; `main()` alone is about 1,000) runs the same seed through one function per area. The command `bun apps/server/src/scripts/e2e-seed.ts` and the seeded rows do not change (D12).

## Step 1 — seed parts

- **Files:** `apps/server/src/scripts/e2e-seed/seed-<area>.ts`, one per block of `main()` in its `HEAD` order (the main organization and its users, the other, trial, paused and stats organizations, approvals, delegates, delegations, open loops, urgency, the rest the worker finds), plus `seed-context.ts`.
- **Interface:** `export interface SeedContext { db; config; baseUrl: string; secret: string; resets: { userId: string; url: string }[]; out } ` and what more two parts share (the worker names it at `HEAD`). Each part: `export async function seed<Area>(ctx: SeedContext): Promise<void>`.
- `e2e-seed.ts` keeps the target guard, the role check, the wipe (before any write), and calls the parts in the `HEAD` order; each part ≤ 400 lines, `e2e-seed.ts` ≤ 250.
- A value that one block computes and a later block reads goes through the return value of the part, not a module-level `let`.
- `seedAssistMailbox` and `wipe` move to the part of their topic or stay in `e2e-seed.ts`; nothing changes in them.
- History: `history-copies.sh` from `e2e-seed.ts` for the parts (D5), then trim and restructure.

## Step 2 — lint borders

- `apps/server/src/modules/layers.json` `rootDeepImportExceptions`: the entry for `scripts/e2e-seed.ts` also covers the parts that deep-import a repository (`scripts/e2e-seed/seed-*.ts`, with the same `why`). Check that `eslint.config.js` and `scripts/module-graph.ts` accept a glob there; if one does not, list each part file.
- If `SIZE_EXCEPTIONS` exists, delete the `e2e-seed.ts` entry; if it was the last, delete the constant and its config block (D4).

## Test

1. **Row-count proof:** run the seed the way `apps/server/test/integration/e2e-seed.test.ts` runs it, at the base (a `git worktree add` in `/tmp`) and at the head, each on a fresh wipe, then `SELECT count(*)` of every table in the `public` schema, ordered by table name. `diff` prints nothing. Save both outputs in `/tmp/f143-s11/`.
2. **Mutation check:** comment out one part call in a scratch edit; check 1 prints a diff. Revert. Write it in the final message.
3. Each part file: `git log --follow` reaches the first commit of `e2e-seed.ts`.
4. `wc -l`: as in step 1.
5. Existing guards, unchanged: `e2e-seed.test.ts` (runs the script; refuses a wrong target).
6. The Playwright suite: `bun run test:e2e`, under `flock /tmp/email-assistant-shared-tests.lock` while `CLAUDE.md` at `HEAD` still names that lock (the parallel-Playwright ticket, F136, removes it). Save the log in `/tmp/f143-s11/e2e.log`.

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s11 && bun run lint > /tmp/f143-s11/lint.log 2>&1 && bun run typecheck > /tmp/f143-s11/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s11/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s11/int.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run test:e2e > /tmp/f143-s11/e2e.log 2>&1 && echo PROOF_OK` (drop the `flock` part if `CLAUDE.md` at `HEAD` no longer names the lock).

## Out of scope

A changed seeded value, a new organization, the demo-week seed of the public-pages ticket (F121).
