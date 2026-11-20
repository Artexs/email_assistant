# F129 stage 12 — E2e seeds, job DB and job tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `e2e-dev`, the standard test. Needs stage 03: the names `e2e:job-env`, `e2e:activity`, `e2e:suggestions`, `demo:org-setup`. Needs stage 04: `scripts/lib/e2e-*-rows.ts`. May run next to 05–11 and 13–15. Build after F136 (parallel Playwright) closes: it owns `e2e-job-env.ts`, `db-worktree.ts` and `scripts/limen-prepare.sh`.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D9. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Callers that read code or text |
| --- | --- | --- | --- |
| `db:worktree` | dev | db | `scripts/limen-prepare.sh`: exit 0, the line `[db-worktree] created `, exactly two lines `^(DATABASE_URL\|MIGRATOR_DATABASE_URL)=`; `--drop` exit code; `apps/server/test/worker-db.ts` imports its args |
| `e2e:job-env` | dev | none | `limen-prepare.sh`: exit 0, stdout key lines; exit 1 "no free e2e port block" |
| `e2e:seed` | dev | db | Playwright `global-setup.ts` (`execFileSync`: any non-zero throws) |
| `e2e:activity` | dev | db | `apps/web/e2e/helpers.ts` |
| `e2e:suggestions` | dev | db | `apps/web/e2e/tests/suggestions.spec.ts` |
| `demo:org-setup` | dev | db | `apps/web/e2e/docs-shots/global-setup.ts` |
| `job:run` | write | db, imap, telegram, llm | runbooks in `deploy/README.md`; `job-run-cli.test.ts` |

`dev` here means: it writes test data or local job state only. The existing refusals stay (D9): "`DATABASE_URL` is not an e2e database" exits 1; `db:worktree` refuses a non-loopback server and the base DB with 1.

## Step 1 — Convert the seven tools

- Follow the recipe. `limen-prepare.sh` runs for every Limen job: its two callers must see the same stdout lines and the same 0 / non-zero split. Run `bash scripts/limen-prepare.sh` in a scratch worktree only if the stage changes a line it reads; else the integration tests are the proof.
- `e2e:seed` reads env only (no `parseArgs`): give it a strict empty parse, so `--no-such-flag` exits 2; its top-level `process.env` read for the GreenMail host default moves into `main`.
- `demo:org-setup` `refusing: bad_args` (exit 1 today) → exit 2 with the usage line; `e2e:activity` already returns 2. The `refusing:` lines for a non-e2e database stay exit 1.
- `job:run` needs: the union of what its jobs touch; `exits[1]`: "the job failed for at least one mailbox".

## Step 2 — Tests

1. `cli-streams-other.test.ts`: `db:worktree` cases unchanged (already 2 for usage, 1 for refusal).
2. `db-worktree-drop.test.ts`: unchanged.
3. `e2e-job-env-cli.test.ts`: unchanged codes; `--help` with no env exits 0 (new case).
4. `e2e-activity.test.ts`: bad arguments → exit 2 (unchanged); non-e2e DB → 1 with `refusing:`.
5. `demo-org-setup.test.ts`: same split as 4.
6. `e2e-seed.test.ts`: `--no-such-flag` → 2; a non-e2e `DATABASE_URL` → 1.
7. `job-run-cli.test.ts`: unchanged lines and codes; unknown job name → 2 if the parser refuses it as an argument.
8. Playwright: the plan.md Proof chain adds `&& bun run test:e2e > /tmp/f129-s12/e2e.log 2>&1` before `echo PROOF_OK`, under the lock rule `CLAUDE.md` states at HEAD.

**Guard check:** remove the "not an e2e database" refusal from `e2e-seed.ts` → test 6 fails; restore. Name both runs in the final message.

## Out of scope

Ports, mail tags and the job e2e DB (F136); seed content.

## Done when

Steps 1–2 done; the seven files are out of `cli-pending.json`; the standard test passes for them; the Proof with `s12` and `test:e2e` prints `PROOF_OK`.
