# F125 stage 10 — G01 part 2: the other five lab bot cases as unit tests

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 09: `lab/mail-client.test-helper.ts` `createFakeLabMailClient` and `lab/bots.test.ts`. Gets a review job (plan § Review).

Group G01 (`MOVE-TO-UNIT`, owner `ok`). Follow plan § Cut stage steps (S1–S7). Same method and decisions as stage 09 (D15).

## Rows of this stage

The five G01 keys of `apps/server/test/integration/lab-bots.test.ts` at data lines 634, 651, 664 (the last three cases of `describe("failed sends")`), 686 ("a long subject is cut to 200 characters…") and 738 ("a failed read of one delegate inbox does not stop the others"). Resolve with `cut-keys --group G01 --area apps/server/test/integration/lab-bots.test.ts` and skip the six keys that stage 09 moved (they resolve to `deferred-none` now; that is expected, not a deferral).

## Step 1 — Move the five cases

- Append them to `apps/server/src/modules/lab/bots.test.ts`, inside a `describe` of the same name where the int file had one ("failed sends").
- Each case keeps its name and every assert. "A failed read of one inbox" uses `failNext("fetchSince", …)` of the fake. A case that needs a fake hook that stage 09 did not build: add the hook to the helper (the port of `lab/mail-client.ts` is the limit, D15).
- Remove the five cases and any helper that no remaining int case uses. The int file keeps the real-IMAP case "6: done sends one reply…".

## Proof (S5)

- Before: the int file and `bots.test.ts`. After: the same two files.
- `--expect unit=+5,int=-5` (less per deferred row).
- Break once: make the reply subject cut at 199 characters in `lab/bots.ts` and see the moved case fail; restore.
- Time: the log shows the int time of `lab-bots.test.ts` before stage 09 (from `audit/cut-s09.md`) and after this stage.

## Out of scope

- Moving any lab case that is not a G01 key.

## Done when

- `audit/cut-s10.md` holds the resolved keys, deferred rows, the `cut-proof` PASS section and the break-once line.
- One commit, message `F125 G01 MOVE-TO-UNIT: lab bot cases 7–11 to unit`.
- Last step: `bun run check:job`; copy its last line.
