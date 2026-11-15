# F113 stage 06 — injector `[risky]`

Part of [`../plan.md`](../plan.md). Decisions D7, D8, D12. Risk area: exactly-once (a double mail changes every count of the run).

## Goal

Each planned slot reaches the run's mailbox once, at its time: by SMTP into the INBOX, or by APPEND into `Sent` for executive-started mail.

## Files

`apps/server/src/modules/lab/injector.ts` and a GreenMail client helper in the same module (SMTP by nodemailer, IMAP by ImapFlow; both are dependencies already).

## Interfaces

```ts
type InjectorDeps = { state: LabState; mail: LabMailClient; spendUsd: () => Promise<number>; now: () => Date; corpus: LabCorpus };
runInjectorTick(deps: InjectorDeps, runId: string): Promise<{ injected: number; late: number; skipped: number; stopped?: "budget" }>;
type LabMailClient = {
  smtpSend(input: { envelopeFrom: string; to: string; raw: string }): Promise<void>;
  appendSent(mailbox: string, raw: string): Promise<void>;                     // folder "Sent", flag \Seen
  hasMessageId(mailbox: string, folder: "INBOX" | "Sent", messageId: string): Promise<boolean>;
  fetchSince(mailbox: string, folder: string, afterUid: number): Promise<{ uid: number; raw: string }[]>;
};
LabCorpus = { scenario; slots: Map<string, Slot>; texts: Map<string, SimText> };   // loaded once per process
```

Stage 07 and stage 13 reuse `LabMailClient`.

## Decisions

- A tick takes the plan items with `at ≤ now` and no `inject_done`, in plan order, at most 20 per tick.
- Budget first: when `spendUsd() ≥ run.capUsd`, append `stopped: budget`, inject nothing, return `stopped`.
- Per item: append `inject_intent` (slot id, Message-ID), send, append `inject_done`. `lateBySec` = `now − at` when over 120 s.
- `smtp`: envelope from = the sender's address, envelope to = the run mailbox only (the other `to` and `cc` personas get no copy). `append_sent`: APPEND to `Sent` of the run mailbox; create the folder when it does not exist.
- Resume: an item with `inject_intent` and no `inject_done` → `hasMessageId` on its folder. Found → append `inject_done` (no resend). Not found → send.
- A send error: no `inject_done`; the next tick tries again. The fifth error for one slot → `skip` with code `smtp_failed` or `append_failed`, then `inject_done` is never written for it. The scorer counts skips.
- Threads: a reply's parent chain comes from `parentId`. A parent that is skipped still gives its Message-ID (the reply keeps its headers).
- The mail client's errors carry codes, never the raw message.
- `mail.hasMessageId` uses IMAP `SEARCH HEADER Message-ID`.

## Tests (integration, shared GreenMail, random mailbox address per test, fake clock)

Use a 5-slot fixture (2 roots, 1 reply to root 1, 1 `sent` slot, 1 later slot), not the real corpus.

1. Clock after the first four slots: 4 delivered — 3 in INBOX, 1 in `Sent` with `\Seen`; the later slot is not sent.
2. The reply in INBOX has `In-Reply-To` = root 1's lab Message-ID and `References` with it.
3. Crash after delivery: write `inject_intent` by hand, deliver the mail by hand, then run a tick → `inject_done` appears, INBOX count stays 1.
4. `inject_intent` with no delivery → the tick sends it once.
5. `spendUsd` returns 5.00 with cap 5 → 0 sent, `stopped: budget`.
6. Clock 10 min after a slot's `at` → `lateBySec` = 600.
7. 25 due items → 20 in the first tick, 5 in the second.
8. SMTP failing 5 times (fake client) → one `skip` with `smtp_failed`; the next slot still goes.
9. Mutation check: remove the resume `hasMessageId` call → test 3 fails (two mails). Restore.

## Check

The new integration test file, then the Proof.

## Done when

Tests 1–9 pass; `live-lab.md` has the injector rules (once per slot, late, skip, budget); the Proof prints `PROOF_OK`. The final message lists each guard (budget, resume check, skip) and the test that fails without it.

## Out of scope

The loop that calls the tick (stage 10). Bots.
