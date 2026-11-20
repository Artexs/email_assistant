# F155 stage 01 — CLI and web wiring, release stamp

Needs: nothing (reads `scripts/job-run.ts`, `scripts/reply-check-copy.ts`, `web-route-deps.ts` `settingsRouteDeps`, which exist). May run next to 02 (both edit `apps/server/src/main.test.ts`: merge master, re-prove).
Part of [`../plan.md`](../plan.md). No review.

Replaces cases C2, C4, C5 and C6 of `plan.md` § Input. Decisions: P2, D1–D5, D8, D9.

## Step 1 — two deps builders (D4)

- `scripts/job-run.ts`: export `jobRunCommitterDeps(config: Config, db: Db): CommitterDeps`. It builds the secret box, the token store (`mailOAuthRuntime(config, db, secrets).tokens`), the scopes and the send limits exactly as the `actions.committer` branch does now. That branch passes the result to `createCommitterJob` unchanged.
- `scripts/reply-check-copy.ts`: export `checkCopyDeps(config: Config, db: Db, open = openMailboxProvider)`. It returns the whole first argument of `checkDraftCopy`: `{ db, openProvider }`. Its `openProvider(ctx, mailboxId)` calls `open({ db, secrets, openProvider: openImapProvider, oauthTokens }, ctx, mailboxId)` and returns `.provider`. `main` passes the result to `checkDraftCopy` unchanged, with no opener of its own. The `open` parameter is for the test only.
- Both scripts keep `if (import.meta.main)`, so a test import runs no CLI.

## Step 2 — the three composition cases (C4, C5, C6)

In `composition.test.ts`, replace the three old cases by these. Use the file's `configWith({})`; the DB is `{} as never`.

1. `jobRunCommitterDeps(configWith({}), {} as never).oauthTokens`: `typeof … .accessToken` is `"function"`. Break: drop the `oauthTokens` field from the builder.
2. `deps = checkCopyDeps(configWith({}), {} as never, spy)`, where `spy` records its first argument and returns `{ provider: P }` (cast; `P` a fixed object). `await deps.openProvider({ orgId: "org-1" }, "mb-1")` is (`toBe`) `P`. The recorded deps have `typeof oauthTokens?.accessToken` `"function"` and `openProvider` (`toBe`) `openImapProvider`; the spy got `"mb-1"`. Break: drop `oauthTokens` from the object the opener passes.
3. `gate = gateEvidenceOf(configWith({}), { quiet: true })`; `settingsRouteDeps({} as never, () => AT, testMailRule(configWith({})), gate).settings.gate` is (`toBe`) `gate`. Break: call `settingsDeps(db, now)` without the gate in `settingsRouteDeps`.

Keep each case name close to the old one (the wiring it guards). Delete the old three cases.

## Step 3 — the release stamp (C2, D2, D3)

4. `main.test.ts`, new case "every JSON line of main.ts carries EA_RELEASE". Spawn `bun main.ts` with `cwd: tmpdir()` and env exactly `{ PATH, DATABASE_URL: "postgres://app:x@127.0.0.1:1/x", CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"), EA_RELEASE: "f155-r1", LOG_FORMAT: "json" }`. Expect exit code 1. The stdout JSON line with `event` `features_off` has `release` `"f155-r1"`. The stderr JSON line with `event` `db_role_check_failed` has `release` `"f155-r1"`. Parse only lines that start with `{`. Break: remove the `setLogRelease` call in `main.ts`.
5. `apps/server/test/integration/job-run-cli.test.ts`, new case "every JSON line of job-run carries EA_RELEASE". `runJob` gets an optional env override. Run `--name platform.retention` with `{ ...process.env, EA_RELEASE: "f155-r1", LOG_FORMAT: "json" }`. Expect exit 0, and the stdout JSON line with `event` `retention_done` has `release` `"f155-r1"`. Break: remove the `setLogRelease` call in `job-run.ts`.

Delete the old `setLogRelease` case of `main.test.ts`. Do not touch the two other cases of `main.test.ts` (C1, C3: stage 02).

## Check

- `bun test apps/server/src/composition.test.ts apps/server/src/main.test.ts`.
- Case 5 needs the job DB: run `bun test apps/server/test/integration/job-run-cli.test.ts` once (the job's own DB from prepare).
- For each of cases 1–5: the break above, the run fails, restore (D8).

## Done when

- None of cases 1–5 reads a source file (D9).
- The final message lists the five breaks and the failing run of each.
- `bun run check:job` passes; the final message copies its last line.

## Out of scope

- The other source-pin cases of `composition.test.ts` (P1).
- A new log line or a change in what the scripts print (P2).
