# F157 stage 03 — time fixes: int files m–r

Needs: none. May run next to 01, 02 and 05.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Probe and § Time fix.

## Step 1 — fix the hits

- **Goal:** no `ea/no-time-literals` hit in `apps/server/test/integration/[m-r]*.ts` (tests and helpers).
- **Size at ea317d34:** 168 hits in 63 files. Largest: `mail-sync.test.ts` 17, `mail-jobs.test.ts` 12, `operator-reads.test.ts` 8, `mail-host-status.test.ts` 6.
- **Known local copy:** `replies-lifetime.test.ts` defines `MINUTE`, `HOUR`, `DAY`; they go (procedures § Time fix step 3).
- **Decisions:** D3. No config change.
- **Test:** none new. The changed files pass in `check:job`.
- **Done when:** the probe on `apps/server/test/integration/[m-r]*.ts` prints no hit; typecheck passes.

## Out of scope

Other name ranges. Splits (stages 13–16 come after this stage).

## Proof

`bun run check:job`, last line in the final message.
