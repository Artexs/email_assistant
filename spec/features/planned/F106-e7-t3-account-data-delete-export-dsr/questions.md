# F106 — defaults taken by the planner (owner to confirm)

No blocking question. Each item is a default in `plan.md` or a stage file; the plan builds with it.

1. [important: user-visible] **"Delete" in the security log** (PD-048) means a refused delete attempt (`org.delete_refused`, wrong password). The org delete removes the whole log, so a row about the delete itself cannot stay. (D15, stage 09)
2. [important: security] **A wrong password in the delete dialog counts as a failed sign-in** for the lockout (10 in 15 minutes lock the user, as at sign-in). Stops password guessing through the dialog with a stolen session. (D4, stage 03)
3. [important: security] **The DSR address hash key** comes from `CREDENTIALS_KEY` by HKDF (label `ea/dsr-address/v1`). No new secret and no `.env` step. A later `CREDENTIALS_KEY` change makes old audit hashes unmatchable to an address. Alternative: a new `DSR_HASH_KEY` secret (owner step). (D13, stage 07)
4. [important: privacy] **Erase also removes the address from texts of kept rows**: subject, body, triage reason and fields, action payload, error and provider result, outbox text and view, delegation task text (replaced by `[removed]`). The discovery text named only to/cc and outbox lines. (stage 06 map, stage 08)
5. [important: privacy] **Export and DSR report encrypt to one `age` public key** (`age1…`), for example the owner's backup key. No passphrase mode. (D6, stages 05, 07)
6. [important: privacy] **A DSR for a member's address or an own mailbox address is refused** (`own_address`). A member's own data goes by the org delete or by the owner. (D10, stage 06)
7. [important: user-visible] **The delete dialog sits behind the flag `org_delete`, default off** (PD-045). The owner turns it on per organization (owner step U2). The CLI `org:delete` has no flag. (P6, stage 03)
8. [important: privacy] **The DSR report** holds the full mails that go; for kept rows it holds only table, id and column, not the text (it also holds other people's data). (stage 07)
9. [minor] **Erase refuses** while an action of a kept mail is open and names the address, or an action of a mail to erase is `applying`; the owner rejects or finishes it, then the operator runs erase again. (D10, stage 08)
10. [minor] **Tombstones** are per organization, keyed by the SHA-256 of the dedup key, and stay until the organization is deleted (no expiry). (D3, stage 01)
11. [minor] **The typed organization name** matches after trim and case-insensitively. (stage 02)
12. [minor] **New dependency** `age-encryption` 0.3.1 (BSD-3-Clause, by the `age` author), exact pin, server only. (stage 05)
13. [minor] **The address is on the CLI command line**, so it is in the operator's shell history; the runbook says to clear that line. (stage 09)
