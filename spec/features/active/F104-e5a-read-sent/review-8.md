# F104 stage 08 review (Opus, job 2026-11-15-f104-review-s08-opus-sent-sync-s-aebe58f5)

Verdict: PASS 164ba422. No blocking finding, no test gap. Landed with --keep-open.

- N1: stage order, org+mailbox scoped delete, audit data and the consent decision all match D2, D5, D11. No consent version field (stage 10 owns the dialog line, D13).
- N2: lock order with the Sent pass is safe (state row first; the pass takes the mailbox KEY SHARE through the FK). A pass that read the state before the off cannot write later (`stateUnchanged`). Two-connection tests are deterministic.
- N3: a stale pass can still run `markSentPass` after off then on and set `last_pass_at` / `last_error_code` on the new period (guard is only `enabled=true`). No mail data. Stage 11 (notice: needs a first pass) must keep this in mind.
- N4: removing `locked.enabled` in `stateUnchanged` is an equivalent mutant.
- N5 (coordinator rule): do NOT turn the flag `sent_sync` on for any non-lab org (`org:flag`, operator route) before stage 10 lands. Stage 13 step 11 checks this. Until stage 09 an owner cannot turn the switch off; only the operator flag stops the pass.
- N6: the F117 OAuth callback may create mailboxes outside `connectMailbox`; they get no state row (= off, safe side, but differs from Q3). F117 stage 09 must set the switch like `connectMailbox`.
- N7: `docs/modules.md` had no row for `mail/sent-switch.ts` (fixed after the land).
- N10: a mailbox delete between `getMailbox` and the lock gives an FK violation; the transaction rolls back and writes nothing. Harmless.
