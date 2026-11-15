# F113 stage 07 — injector `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D7, D8, D12. Risk: exactly-once. Review 1: B3, B5, T7.

## Goal

Each planned slot reaches the run's mailbox once, at its time: SMTP into the INBOX, or APPEND into `Sent` for executive mail.

## Files

`apps/server/src/modules/lab/injector.ts` and a GreenMail client helper in the same module (SMTP by nodemailer, IMAP by ImapFlow; both are dependencies already).

## Interfaces

```ts
type InjectorDeps = { state: LabState; mail: LabMailClient; spendUsd: () => Promise<number>; now: () => Date; corpus: LabCorpus };
runInjectorTick(deps: InjectorDeps, runId: string): Promise<{ injected: number; late: number; skipped: number; stopped?: "budget" }>;
type LabMailClient = {
  smtpSend(input: { envelopeFrom: string; to: string; raw: string }): Promise<void>;
  appendSent(mailbox: string, raw: string): Promise<void>;                     // folder "Sent", flag \Seen
  hasMessageId(mailbox: string, messageId: string): Promise<boolean>;   // every folder of the mailbox
  fetchSince(mailbox: string, folder: string, afterUid: number): Promise<{ uid: number; raw: string }[]>;
};
```

`LabCorpus` is stage 04's. Stages 08 and 14 reuse `LabMailClient`.

## Decisions

- A tick takes the plan items with `at ≤ now` and neither `inject_done` nor `skip`, in plan order, at most 20 per tick (review T7).
- Budget first: when `spendUsd() ≥ run.capUsd`, inject nothing and return `stopped: "budget"`. The serve loop calls `stopRun` (stage 04: only `stopRun` writes `stopped`; review B5).
- Per item: append `inject_intent` (slot id, Message-ID), send, append `inject_done`. `lateBySec` = `now − at` when over 120 s.
- `smtp`: envelope from = the sender's address, envelope to = the run mailbox only (the other `to` and `cc` personas get no copy). `append_sent`: APPEND to `Sent` of the run mailbox; create the folder when it does not exist.
- Resume: an item with `inject_intent` and no `inject_done` → `hasMessageId` over **every folder** of the run mailbox (the sim server may have moved the mail out of the INBOX already; review B3). Found → append `inject_done` (no resend). Not found → send.
- A send error: append `inject_error` (slot id, code), no `inject_done`; the next tick tries again. The fifth `inject_error` for one slot (counted from the events, so it survives a restart) → `skip` with code `smtp_failed` or `append_failed`. A skipped slot is never selected again. The scorer counts skips.
- A skipped parent still gives its Message-ID to its replies.
- Mail client errors carry codes, never the raw message.
- `mail.hasMessageId` lists the folders and runs IMAP `SEARCH HEADER Message-ID` in each.

## Tests (integration, shared GreenMail, random mailbox address per test, fake clock)

Use a 5-slot fixture (2 roots, 1 reply to root 1, 1 `sent` slot, 1 later slot), not the real corpus.

1. Clock after the first four slots: 4 delivered — 3 in INBOX, 1 in `Sent` with `\Seen`; the later slot is not sent.
2. The reply in INBOX has `In-Reply-To` = root 1's lab Message-ID and `References` with it.
3. Crash after delivery: write `inject_intent` by hand, deliver the mail by hand, then run a tick → `inject_done` appears, INBOX count stays 1.
3b. Same, but move the delivered mail to a folder `Newsletters` before the tick → no second mail in any folder (review B3).
4. `inject_intent` with no delivery → the tick sends it once.
5. `spendUsd` returns 5.00 with cap 5 → 0 sent, the tick returns `stopped: "budget"` and writes no `stopped` event.
6. Clock 10 min after a slot's `at` → `lateBySec` = 600.
7. 25 due items → 20 in the first tick, 5 in the second.
8. SMTP always failing (fake client) → 5 `inject_error` events, then one `skip` with `smtp_failed`; later ticks add no event for that slot; the next slot still goes. With 3 errors, a restart, then 2 more → `skip`.
9. Mutation check: search only the INBOX in the resume check → test 3b fails. Restore.

## Check

The new integration test file, then the Proof.

## Done when

Tests 1–9 pass; `live-lab.md` has the injector rules (once per slot, late, skip, budget); the Proof prints `PROOF_OK`. The final message lists each guard (budget, resume check, skip) and the test that fails without it.

## Out of scope

The loop that calls the tick (stage 11). Bots.
