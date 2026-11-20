# F125 stage 09 — G01 part 1: a fake lab mail client and the first six lab bot cases as unit tests

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts`. May run next to 11–20. Gets a review job (plan § Review).

Group G01 (`MOVE-TO-UNIT`, owner `ok`). Rows and evidence: `audit/review-int-e2e.md` (rows with `lab-bots.test.ts`), keys in `audit/approval-groups.tsv`. Follow plan § Cut stage steps (S1–S7).

## Rows of this stage

The six G01 keys of `apps/server/test/integration/lab-bots.test.ts` at data lines 255, 272, 304, 433, 581 and 610 (re-resolved by `cut-keys --group G01 --area apps/server/test/integration/lab-bots.test.ts`; take the first six by old line). Names at the data base: "7: other_address answers…", "8: out_of_office answers…", "late: nothing for the delegation…", "10: no lab id…", "an automatic mail (Auto-Submitted…)", and the case at 610 inside `describe("failed sends")`. Stage 10 takes the other five lab keys. The real-IMAP case "6: done sends one reply…" (data line 222) stays in the int file and is no row.

## Step 1 — The fake

- **Interface (stage 10 uses it):** `apps/server/src/modules/lab/mail-client.test-helper.ts` exports `createFakeLabMailClient(options?: { allowedAddresses?: ReadonlySet<string> })`. It returns a `LabMailClient` (the five methods of `lab/mail-client.ts`) plus read-only records for asserts: `sent` (each `smtpSend` input in order), `appended` (mailbox, raw), and a `deliver(mailbox, folder, raw)` that adds a mail with the next UID. Hooks to make one call fail: `failNext(method, error)`.
- **D15** The fake is in-memory, keeps the UID order and "missing folder → empty list / 0" of the port comments, and refuses an envelope address outside `allowedAddresses` like the real client (same error type). Reason: the moved cases check the bot logic over the port; a fake that is looser than the port hides a bot bug. Rejected: a `mock()` per method in each case (each case would restate the port).
- `*.test-helper.ts`: the mutation default and the scan treat it as test support (README); no production file imports it.

## Step 2 — Move the six cases

- New file `apps/server/src/modules/lab/bots.test.ts`. Each moved case keeps its name and every assert; only the client changes from GreenMail to the fake. One unit case per int case (no table).
- Remove the six cases from the int file, with helpers that no remaining case uses.
- A moved case whose assert needs real IMAP behaviour (a server move between folders, a real `Message-ID` search): do not move it; defer the row with that reason.

## Proof (S5)

- Before: the int file. After: the int file and `bots.test.ts`.
- `--expect unit=+6,int=-6` (fewer when rows defer: −1/+1 per deferred row less).
- Break once: in `lab/bots.ts`, invert the Auto-Submitted check and see the moved case fail; restore. List it in the log.

## Out of scope

- The injector and serve tests that the fake could also move (`audit/report.md` § 4 item 1): a later ticket.
- Any change of `lab/bots.ts` or `lab/mail-client.ts`.

## Done when

- `audit/cut-s09.md` holds the resolved keys, the deferred rows with reasons, the `cut-proof` section (PASS), and the break-once line.
- One commit for the fake and the moves, message `F125 G01 MOVE-TO-UNIT: lab bot cases 1–6 to unit`.
- Last step: `bun run check:job`; copy its last line.
