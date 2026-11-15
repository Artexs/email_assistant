# F113 stage 14 review (Opus 5.5, PASS 41bf5ef2)

Model: Opus 5.5, because the stage is [risky]: it deletes the data of the lab org. No BLOCKING, no TEST GAP.

Verified: the three guards (org name exact, `orgs.json` address, every mailbox row of the org) refuse case, space and no-break-space tricks, a `demo` entry that names the lab org id, and a real org that shares the demo address (reviewer tests A1-A5); `delete_organization` is one transaction and every `org_id` table goes by cascade (a new table without cascade fails `account-data-delete.test.ts`; the reset tests count rows in every `org_id` table through `information_schema`); without `--yes` both commands exit 1 `confirm_needed`; `--org` takes only `lab|demo`; the mail client refuses a non-loopback host (`host_refused`); the bot Message-ID compare (`lastIndexOf(":")`) and `received_changed` skip are right; `demo-export` and `demo-import` stay `not built`; 16 worker mutations killed, the reviewer's three (run filter, clearing all entries, INBOX only) killed.

Notes (carry-over to stage 15, which touches the same module):
- N1 (proven by reviewer test A7): an org with no mailbox row whose name is exactly the lab name and that `orgs.json` names is deleted (`live-lab.md` 23.2 says a repair case may pass). Hardening: also require that every member email of the org equals `target.mailbox` (the seed uses the mailbox address as the owner email).
- N2 (proven by reviewer test A6, TOCTOU): the guards run before the delete transaction. A mailbox row added in the window (about 0.3 s: IMAP count and run stop) is deleted with the org. `deleteOrganization` re-checks only the name under `FOR UPDATE`. Fix: check guard 3 inside the delete transaction (an expected-mailboxes option on `deleteOrganization`, or the guard again on `trx`).
- N3: `delete_organization` deletes the org's audit rows, so no reset audit row stays; the trace is the `org_deleted` log line, the `stopped: operator` event and the ledger line (no mail text). Decide if a reset audit row is wanted.
- N4: `stopRunsOf` runs before `deleteOrg`: a `delete_refused` or `delete_busy` result leaves the runs stopped (the docs promise "no stopped run" only for `org_mismatch`, which holds).
- N5: the comment at `apps/server/src/modules/lab/seed.ts` line 43 says "the lab never deletes its org": stale.
- N6: the preview prints the lab mailbox address (the stage asks for it; a `.test` address).
