# F157 stage 02 — time fixes: int files a–l

Needs: none. May run next to 01, 03 and 05.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Probe and § Time fix.

## Step 1 — fix the hits

- **Goal:** no `ea/no-time-literals` hit in `apps/server/test/integration/[a-l]*.ts` (tests and helpers).
- **Size at ea317d34:** 259 hits in 101 files. Largest: `contacts-suggestions.test.ts` 17, `actions-repo.test.ts` 15, `channels-report-mail-append.test.ts` 14, `actions-undo.test.ts` 8.
- **Decisions:** D3. No config change: stage 04 turns the rule on for this folder.
- **Shared helpers:** a fix in `fixtures.ts`, `helpers.ts` or another `*-fixtures.ts` keeps each export name and type.
- **Test:** none new. The changed files pass in `check:job` (it runs the int tests that import a changed file).
- **Done when:** the probe on `apps/server/test/integration/[a-l]*.ts` prints no hit; typecheck passes.

## Out of scope

Files from `m` on (stages 03 and 04). Splits (stages 08–12 come after this stage).

## Proof

`bun run check:job`, last line in the final message.
