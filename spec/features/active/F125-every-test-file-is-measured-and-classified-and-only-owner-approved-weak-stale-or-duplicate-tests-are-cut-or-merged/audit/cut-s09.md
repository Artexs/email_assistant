# Cut stage 09: lab bot cases 1–6 to unit

Base: `e2bfbc7c`. Scan: `scan-cli.ts` at the base, then `cut-keys.ts --group G01 --area apps/server/test/integration/lab-bots.test.ts` (11 keys, all `ok`). This stage takes the first six by old line; the other five (`:634`, `:651`, `:664`, `:686`, `:738`) are for the next lab-bots stage.

## Resolved keys

| old key (int file) | status | new place |
|---|---|---|
| `lab-bots.test.ts:255` 7: other_address answers from the private address of the delegate | ok | `apps/server/src/modules/lab/bots.test.ts` |
| `lab-bots.test.ts:272` 8: out_of_office answers a delegation and a reminder with Auto-Submitted and never with done | ok | same |
| `lab-bots.test.ts:304` late: nothing for the delegation, one done for the first reminder, nothing for the second | ok | same |
| `lab-bots.test.ts:433` 10: no lab id, a slot of category info, … → no reply | ok | same |
| `lab-bots.test.ts:581` an automatic mail (Auto-Submitted other than no) gets no reply; Auto-Submitted: no does | ok | same |
| `lab-bots.test.ts:610` the fifth failed send ends the reply with skip send_failed; the next ticks stay quiet | ok | same (inside `describe("failed sends")`) |

Deferred rows: none. Rejected rows: none. Open branches: no unmerged `limen/*` branch changes `lab-bots.test.ts`, `lab/bots.ts` or `lab/mail-client.ts` (checked with `git diff --name-only <merge-base>...<branch>`).

## Changes

- New fake `apps/server/src/modules/lab/mail-client.test-helper.ts`: `createFakeLabMailClient({ allowedAddresses })` with `sent`, `appended`, `calls`, `deliver`, `failNext`. With no `allowedAddresses` it refuses every envelope address.
- The delegate mail of each moved case goes in through `deliver` (the sim server sends it, with no address check); replies go through the bot's `smtpSend` into the run mailbox INBOX.
- Case "the fifth failed send": the failing client of the int case becomes five `failNext("smtpSend", …)` calls; its call count assert reads `calls.smtpSend`. Every other assert is unchanged.
- Int file: the six cases and the helper options that no remaining case uses (`from`, `text` of `sendToDelegate`, `WED_NOON`) are removed. The unused slot entries `w-1-002`…`w-1-007` of the corpus stay (data, not a helper).

## Break once

In `lab/bots.ts`, the Auto-Submitted check inverted (`!== "no"` → `=== "no"`): `bun test apps/server/src/modules/lab/bots.test.ts` → 1 fail (`an automatic mail (Auto-Submitted other than no) gets no reply; Auto-Submitted: no does`), 5 pass. `bots.ts` restored (`git checkout`; no diff).

## cut-proof, stage 09

Before: `/tmp/f125-s09/before-1`, `/tmp/f125-s09/before-2`. After: `/tmp/f125-s09/after`. Expected: unit=+6, int=-6.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 0 | 6 | 0.00 s | 1.40 s |
| int | 23 | 17 | 83.90 s | 56.32 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS

