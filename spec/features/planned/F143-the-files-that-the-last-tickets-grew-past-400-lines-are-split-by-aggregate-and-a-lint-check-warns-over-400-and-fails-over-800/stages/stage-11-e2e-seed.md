# F143 stage 11 — e2e seed steps by area

Needs: nothing. Reads `size-exceptions.json` of stage 01 only if it exists at `HEAD`. May run next to every other stage (it imports names from `./e2e-seed-args`, which stage 10 keeps). Overlap (advisory): the public pages (F121 stage 09) and the demo-video ticket (F151) edit the seed; on a land conflict, D6. Changes `layers.json`.
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

- `apps/server/src/modules/layers.json` `rootDeepImportExceptions`: add one entry per part file that deep-imports a repository (`scripts/e2e-seed/seed-<area>.ts`, the same `why`). No glob: `modules/layers.test.ts` checks each `file` with `existsSync`. Check that `apps/server/src/scripts/module-graph.ts` reads the new entries.
- If `size-exceptions.json` exists, delete the `e2e-seed.ts` entry; if it was the last, delete the file, its read and its block in `eslint.config.js` (D4).
- `apps/server/src/scripts/e2e-mail-tag.test.ts` reads `e2e-seed.ts` for every `e2e…Mailbox` use and for the body of `seedAssistMailbox`: it reads `e2e-seed.ts` and every `e2e-seed/seed-*.ts` instead (path only, no assert change).

## Test

1. **Row proof:** run the seed the way `apps/server/test/integration/e2e-seed.test.ts` runs it, before the first change and after the trim, each on a fresh wipe. Then dump every table of the `public` schema: the rows with `uuid` and time columns left out, sorted, plus the row count per table and organization name (join to `organizations`). `diff` prints nothing. Save both dumps in `/tmp/f143-s11/`.
2. **Mutation checks:** comment out one part call; change one seeded name. Each time check 1 prints a diff. Revert. Write both in the final message.
3. Each part file: `git log --follow` reaches the first commit of `e2e-seed.ts`.
4. `wc -l`: as in step 1.
5. Existing guards, unchanged: `e2e-seed.test.ts` (runs the script; refuses a wrong target).
6. The Playwright suite: `bun run test:e2e`, under `flock /tmp/email-assistant-shared-tests.lock` while `CLAUDE.md` at `HEAD` still names that lock (the parallel-Playwright ticket, F136, removes it). Save the log in `/tmp/f143-s11/e2e.log`.

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s11 && bun run lint > /tmp/f143-s11/lint.log 2>&1 && bun run typecheck > /tmp/f143-s11/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s11/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s11/int.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run test:e2e > /tmp/f143-s11/e2e.log 2>&1 && echo PROOF_OK` (drop the `flock` part if `CLAUDE.md` at `HEAD` no longer names the lock).

## Out of scope

A changed seeded value, a new organization, the demo-week seed of the public-pages ticket (F121).
