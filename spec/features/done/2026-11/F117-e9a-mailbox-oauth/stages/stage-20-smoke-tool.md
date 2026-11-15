# F117 stage 20 — Operator tools on OAuth mailboxes; the smoke seed

Part of [`../plan.md`](../plan.md). Needs stage 10.

## Step 20.1 — Operator CLIs open through `openMailboxProvider`

**Goal.** `mailbox:seed`, `mailbox:rescan`, `mailbox:backfill`, `mailbox:audit` and `mailbox:signals` work on an OAuth mailbox (PD-091 smoke).

**Rules.**
- Every CLI that opens a stored mailbox gets its provider through `openMailboxProvider` with the real `oauthTokens` of the composition. No CLI decrypts a secret itself after this stage.
- A refresh error in a CLI prints the reason code and exits 1; it does not change the mailbox status (only the jobs do).
- CLIs that take a host and a password on the command line (`mailbox:check`, the probes) do not change.
- Testability (B6 of the plan review): each touched CLI exports `run(argv: string[], deps: CliDeps): Promise<number>`; `main()` builds the production deps (constant registry) and calls it. The OAuth tests call `run` in the test process with the fake registry. The subprocess tests of the password paths stay. No env key holds a URL (D6).

## Step 20.2 — Smoke seed

**Interface** (extends `bun run mailbox:seed`):
- `TEST_MAILBOX_ADDRESS` accepts a comma-separated list; seed refuses a mailbox not in it (Q9). One address works as today.
- New `--from-owner <address>` (D20): each seeded `From` address becomes `<local>+ea-smoke-<nn>@<domain>` of the given address (`nn` = 01, 02, … in seed order, from `--number-from <n>`, default 1); the display name stays. `To` becomes the mailbox address. A reply or delegation then reaches only the owner (spike rows M10 and G5 check that plus addresses arrive).
- Without `--from-owner` on a mailbox whose `oauth_provider` is set: refuse (exit 1, `--from-owner is required for a real provider mailbox`). Real mailboxes never get mail with outside `From` addresses.
- Cases (Q7): `--eval-cases synthetic --per-category 3` (15 mails: 3 each of `urgent`, `needs_reply`, `info`, `notification`, `spam`) plus `--eval-cases delegation --per-category 5` (5 mails) = 20. A frozen E2a bank (the offline-lab ticket, F097) is a later option; never its holdout part.

**Decisions.** D18, D20, D21.

**Edge cases.**
- The seeded mail keeps the synthetic Message-ID domain (`@ea-seed.test`), so measurement and retention treat it as test mail as today.
- `--from-owner` with an address without `@` → usage error.

**Test.**
1. Unit: the `From` rewrite of `"Marek Zielinski <marek.zielinski@klient-alfa.test>"` with `owner@x.test`, case 3 → `"Marek Zielinski <owner+ea-smoke-03@x.test>"`.
2. Unit: `TEST_MAILBOX_ADDRESS="a@x.test, b@x.test"` admits both and refuses `c@x.test`.
3. In-process `run` (GreenMail, fake token server): `mailbox:seed --eval-cases synthetic --per-category 3 --from-owner owner@x.test`, then `--eval-cases delegation --per-category 5 …`, on a Google OAuth mailbox → 15 + 5 mails; every `From` a plus address of `owner@x.test`; the second run with `--number-from 16` gives 16–20, so 01–20 do not repeat.
4. In-process: the same without `--from-owner` → exit 1, nothing appended.
5. In-process: `mailbox:audit` on that mailbox after one sync → exit 0.
6. In-process: a refresh error (fake `invalid_grant`) in `mailbox:audit` → exit 1 with `oauth_expired`; status unchanged.
7. Canary: no token in CLI stdout or stderr.

**Check.** The Proof.

**Done when.** The tests pass; no CLI module decrypts a mailbox secret except through `openMailboxProvider` (`grep` for the decrypt call in `apps/server/src/scripts` and `mail/tools.ts` finds none; this is the acceptance); the Proof prints `PROOF_OK`.

**Out of scope.** The real run (stage 21).
