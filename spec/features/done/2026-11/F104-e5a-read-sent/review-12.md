# F104 stage 12 review (Opus 5.5, PASS 47c8ff10)

Model: Opus 5.5, because the stage is [risky]: privacy and a delete of mail data. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (a sent row from the person in upper case; mutant `lower(s.from_address)` -> `s.from_address` survived the stage suites), TG2 (a failed erase rolls back the sent rows, the `pending` rows, the tombstones and the audit row), and small doc drifts.

Verified: the find matches a sent row when the person is in from, to or cc and every other address is an own mailbox (a row from the person goes only when every other party is own: by design); second-org isolation; an own address is refused; one transaction (org row, `mailbox_folders`, then `mailbox_sent_sync` by mailbox id); tombstones hold only `key_hash` (one per distinct key); kept `pending` rows become `headers_only`; the text step writes only where `content = 'pending'`, so a late text write cannot add the person back; the audit and the CLI hold counts only; no migration, seed or `features.ts` change.

Notes:
- Five worker survivors (`aftercheck`, `deleteorg`, `pendingorg`, `reportorg`, `lockorg`) are equivalent: the scrub runs before the after-match with the same predicates; deletes and updates use uuid ids from an org-filtered match; the lock filter is hidden by RLS. The filters stay in the code (rule: every query filters `org_id`); tests R1 and R2 prove the behaviour.
- A deadlock between the erase and a mailbox delete cascade is possible in theory (not tested); the erase retries a deadlock once.
- No test covers a cleared row among the sent mails of the find report (code reading: `body_text: null`).
