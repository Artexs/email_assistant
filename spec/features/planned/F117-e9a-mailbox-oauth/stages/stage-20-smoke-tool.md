# F117 stage 20 — Operator tools on OAuth mailboxes; the smoke seed

Part of [`../plan.md`](../plan.md). Needs stage 10.

## Step 20.1 — Operator CLIs open through `openMailboxProvider`

**Goal.** `mailbox:seed`, `mailbox:rescan`, `mailbox:backfill`, `mailbox:audit` and `mailbox:signals` work on an OAuth mailbox (PD-091 smoke).

**Rules.**
- Every CLI that opens a stored mailbox gets its provider through `openMailboxProvider` with the real `oauthTokens` of the composition. No CLI decrypts a secret itself after this stage.
- A refresh error in a CLI prints the reason code and exits 1; it does not change the mailbox status (only the jobs do).
- CLIs that take a host and a password on the command line (`mailbox:check`, the probes) do not change.

## Step 20.2 — Smoke seed

**Interface** (extends `bun run mailbox:seed`):
- `TEST_MAILBOX_ADDRESS` accepts a comma-separated list; seed refuses a mailbox not in it (Q9). One address works as today.
- New `--limit <n>` with `--eval-cases`: the first `n` cases by id after the per-category pick.
- New `--from-owner <address>` (D20): each seeded `From` address becomes `<local>+ea-smoke-<nn>@<domain>` of the given address (`nn` = 01, 02, … in seed order); the display name stays. `To` becomes the mailbox address. A reply or delegation then reaches only the owner (plus addressing works at Gmail and Exchange Online).
- Without `--from-owner` on a mailbox whose `oauth_provider` is set: refuse (exit 1, `--from-owner is required for a real provider mailbox`). Real mailboxes never get mail with outside `From` addresses.
- Cases: `--eval-cases synthetic` (Q7). A frozen E2a bank (the offline-lab ticket, F097) is a later option; never its holdout part.

**Decisions.** D18, D20, D21.

**Edge cases.**
- The seeded mail keeps the synthetic Message-ID domain (`@ea-seed.test`), so measurement and retention treat it as test mail as today.
- `--from-owner` with an address without `@` → usage error.

**Test.**
1. Unit: the `From` rewrite of `"Marek Zielinski <marek.zielinski@klient-alfa.test>"` with `owner@x.test`, case 3 → `"Marek Zielinski <owner+ea-smoke-03@x.test>"`.
2. Unit: `TEST_MAILBOX_ADDRESS="a@x.test, b@x.test"` admits both and refuses `c@x.test`.
3. Integration (GreenMail, fake token server): `mailbox:seed --eval-cases synthetic --limit 20 --from-owner owner@x.test` on a Google OAuth mailbox appends 20 mails, all `From` plus addresses of `owner@x.test`.
4. Integration: the same without `--from-owner` → exit 1, nothing appended.
5. Integration: `mailbox:audit` on that mailbox after one sync → exit 0.
6. Integration: a refresh error (fake `invalid_grant`) in `mailbox:audit` → exit 1 with `oauth_expired`; status unchanged.
7. Canary: no token in CLI stdout or stderr.

**Check.** The Proof.

**Done when.** The tests pass; no CLI module decrypts a mailbox secret except through `openMailboxProvider` (`grep` for the decrypt call in `apps/server/src/scripts` and `mail/tools.ts` finds none; this is the acceptance); the Proof prints `PROOF_OK`.

**Out of scope.** The real run (stage 21).
