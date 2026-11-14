# F106 stage 09 — Security-log kinds and docs

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

**Files.** A new `docs/capabilities/account-data.md` (the capability page shape of `tenancy-and-plans.md`: what it does, rules, entry points, data, limits, decisions, tests) and its line in `docs/capabilities/README.md`; the `Limits` lines about F106 in `tenancy-and-plans.md`, `retention.md` and `web-panel.md`; a tombstone rule in `sync.md`; `docs/architecture.md` §7 ("Delete": organization delete, DSR erase, tombstones); `docs/code-patterns.md`; `deploy/README.md`; `docs/modules.md` (module `privacy`).

**Decisions.** D1, D16, D18, P2.

- `docs/code-patterns.md` § Data access: (a) module `privacy` runs generic SQL over `EXPORT_MAP` and `DSR_ADDRESS_MAP`, the exception to "the module that owns a text column clears it"; (b) a new table or column: classify it in `EXPORT_MAP`, and, when the completeness test of stage 06 lists it, in `DSR_ADDRESS_MAP` or `NOT_PERSONAL`, in the ticket of its migration; (c) a new table with `org_id` or `user_id` gets a seed in the deletion test of stage 01.
- `deploy/README.md`, a section "Account data (F106)":
  - Delete: `org:delete --org-id <id> --confirm <name>`; tell the owner which mailbox passwords to change.
  - Export: `mkdir -m 700 <host folder>`, then `$C run --rm -v <host folder>:/exports server bun run org:export --org-id <id> --recipient <age1…> --out /exports/<org id>-<date>.age`; give the file to the owner by a private channel; delete it after the delivery.
  - Data request (GDPR Art. 12(3): answer within one month): act only on the owner's written instruction; run `--find` (with a report for an access request), send the report to the owner, then `--erase --confirm` when the owner asks; on `open_actions`, the owner rejects or finishes those sends first; delegates and rules that hold the address stay until the owner changes them; the mail stays in the mailbox (P2), the owner deletes it there if wanted; backups keep the rows until they expire.
  - The address is in the shell history of the command: clear that line after the run.
- The flag `org_delete`: off by default; `org:flag … --flag org_delete --on` per organization.

**Test.** `bunx prettier --check` on the changed docs.

**Check.** `bun test packages/core apps/web` and the security-log integration test; `bun run web:build`.

**Done when.** Step 1 tests pass, every doc above is changed, and the plan Proof (web chain) prints `PROOF_OK`.

**Out of scope.** The legal papers (F107 cites the runbook).
