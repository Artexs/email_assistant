# F157 stage 04 — time fixes s–z; the rule covers all test code

Needs stage 01: the two temporary ignores in the `ea/no-time-literals` block. Needs stages 02 and 03: no hit left in `apps/server/test/integration/[a-r]*.ts`.

Part of [`../plan.md`](../plan.md). Steps: [`../procedures.md`](../procedures.md) § Probe and § Time fix.

## Step 1 — fix the rest

- **Goal:** no hit in `apps/server/test/integration/[s-z]*.ts`, in the other folders of `apps/server/test/`, and in `tools/*/test/`.
- **Size at ea317d34:** 208 hits in 72 files. Largest: `triage-service.test.ts` 26, `tools/fake-telegram/test/lab-executive.test.ts` 16, `trust-history-job.test.ts` 9.
- **Decisions:** D3.

## Step 2 — rule on everywhere

- **Goal:** the rule covers all test code (D1).
- **Change:** remove the two temporary ignores of stage 01. Run `bun run lint` over the whole repo. Fix each hit that other tickets added since stages 01–03 (D3), wherever it is.
- **Docs (D13):** `docs/code-patterns.md` § Size and shape: the time rule covers test code; `time.ts` and `time.test.ts` are the only files out. Change the matching words in `.agents/limen/styleguide.md` only if it says tests are out.
- **Test** (`time-lint.test.ts`, scope): case 3 of stage 01 becomes `[2]` for `apps/server/test/integration/x.ts`, `apps/server/test/integration/x.test.ts` and `tools/fake-telegram/test/x.test.ts`. Restore one ignore and see the case fail.
- **Done when:** `bun run lint` passes (save the log to `/tmp/f157-s04/lint.log`); `bun test apps/server/src/platform/time-lint.test.ts` passes.

## Out of scope

The size rule. Any rule change beyond the ignores.

## Review

`claude-sonnet-5-5` review before the land (lint config).

## Proof

`bun run check:job`, last line in the final message.
