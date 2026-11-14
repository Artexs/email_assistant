# F106 stage 10 — Security-log kinds and docs

Part of [`../plan.md`](../plan.md). New Polish text (review before the land).

## Step 1 — four security-log kinds

**Goal.** The owner sees exports, refused delete attempts and data requests in the security log (PD-048).

**Files.** `packages/core/src/security-log.ts`; `apps/web/src/i18n/en.ts`, `pl.ts`.

**Decisions.** D14, D15. `securityEventKinds` gets `data_exported`, `delete_refused`, `dsr_find`, `dsr_erase`; `securityEvents` gets `"org.exported": "data_exported"`, `"org.delete_refused": "delete_refused"`, `"dsr.find": "dsr_find"`, `"dsr.erase": "dsr_erase"`. The F105 two-factor kinds may land in the same file first: merge, keep both.

**Texts** (copy word for word):

| Key | en | pl |
| --- | --- | --- |
| `sec_kind_data_exported` | Data export made | Wykonano eksport danych |
| `sec_kind_delete_refused` | Organization delete refused: wrong password | Odmowa usunięcia organizacji: złe hasło |
| `sec_kind_dsr_find` | Data request: a person's data searched | Wniosek o dane: wyszukano dane osoby |
| `sec_kind_dsr_erase` | Data request: a person's data erased | Wniosek o dane: usunięto dane osoby |
| `sec_help` (changed) | Sign-ins, lockouts, password and two-factor changes, sessions ended, data exports, refused delete attempts and data requests of this organization in the last 90 days. | Logowania, blokady, zmiany hasła i logowania dwuetapowego, zakończone sesje, eksporty danych, odrzucone próby usunięcia i wnioski o dane tej organizacji z ostatnich 90 dni. |

**Test.**

1. The registry unit test: each new code maps to its kind, and every `securityEvents` key is a value of `auditEvents`.
2. `listSecurityLog` (integration): one row of each of the four events in the organization → four entries with the kinds; the actor of a `cli` row is `operator`.
3. `i18n.test.ts` passes.

## Step 2 — docs and the runbook

**Goal.** The docs describe what landed; the operator has the steps.

**Files.** A new `docs/capabilities/account-data.md` (shape of `tenancy-and-plans.md`) and its line in the capabilities `README.md`; the F106 `Limits` lines of `tenancy-and-plans.md`, `retention.md`, `web-panel.md`; a tombstone rule in `sync.md`; `docs/architecture.md` §7 "Delete"; `docs/code-patterns.md`; `docs/modules.md`; `deploy/README.md`.

**Decisions.** D1, D18, D20, P2.

- `docs/code-patterns.md` § Data access: (a) module `privacy` runs generic SQL over its registries, the exception to "the module that owns a text column clears it"; in the ticket of a migration: (b) classify each new table and column in `EXPORT_MAP`, and each new candidate column (stage 06) in `DSR_ADDRESS_MAP` or `NOT_PERSONAL`; (c) a new `org_id` or `user_id` table gets a seed in the deletion test; (d) a new mail table gets the tombstone trigger; (e) a new notice kind gets its `NOTICE_MAIL_CONTENT` class.
- `deploy/README.md`, section "Account data (F106)":
  - Delete: `org:delete --org-id <id> --confirm <name>`; tell the owner which mailbox passwords to change.
  - Export: `mkdir -m 700 <host folder>`; `$C run --rm -v <host folder>:/exports server bun run org:export --org-id <id> --recipient <age1…> --out /exports/<org id>-<date>.age`; hand the file over by a private channel; delete it after the delivery.
  - Data request (GDPR Art. 12(3): answer within one month), only on the owner's written instruction: `--find` (with a report for an access request) → report to the owner → `--erase --confirm` when the owner asks. `open_actions`: the owner rejects or finishes those sends first. `blocked`: a bug, report the constraint. Delegates and rules with the address stay until the owner changes them. The mail stays in the mailbox and delivered Telegram messages stay in the chat (P2); the owner deletes them there if wanted. Backups keep rows until they expire.
  - Restore (D20): a backup restore brings back deletes and erases made after the backup. Keep each `deleted …` and `record: …` line outside the server; the owner keeps the request. After a restore (`deploy/README.md` § Backups), run them again before the panel opens.
  - Clear the shell-history line that holds the address. Remove a deleted user's id from `OPERATOR_USER_IDS` at the next `.env` change.
- The flag `org_delete`: off by default; `org:flag … --flag org_delete --on` per organization.

**Test.** `bunx prettier --check` on the changed docs.

**Done when.** Step 1 tests pass, every doc above is changed, and the plan Proof (web chain) prints `PROOF_OK`.

**Out of scope.** The legal papers (F107 cites the runbook).
