# F113 stage 15 review (Opus 5.5, FAIL b2bb6517, repaired)

Model: Opus 5.5, because the stage is [risky]: data integrity and private data, and `--replace` deletes an org.

BLOCKING B1 (repaired in a Sonnet continue; a narrow re-review follows): the export let a real address with a quoted local part (`"john"@gmail.com`) or an address literal (`john@[10.0.0.1]`) into the seed file: the scan keyed on the word before the `@` and `"` and `[` are delimiters. The scan now keys on each `@` and the domain run after it, NFKC-normalizes, and decodes `%40` and the HTML entities of `@`.

TG1 fixed (hardening): `--replace` deletes only an org whose every mailbox has the placeholder secret and status `paused` (only the import writes these) and refuses an org with no mailbox when the seed has mailboxes. `--replace` stays: the stage asks for it (Import guard bullet, the `replace: boolean` interface, test 6).

Verified: the guards, the id map (a schema check fails on a new FK column, an exported JSON column or a uuid `id` column), a crafted seed (`__proto__` key, a duplicate id, a self-reference cycle, a foreign `org_id`) refuses or rolls back with no partial org; the stage 14 carry-over (a concurrency test: an uncommitted mailbox insert, then the delete waits on the org lock and refuses with `scope_mismatch`; an org with the demo name and no mailbox owned by another person is refused; existing callers of `deleteOrganization` pass); the CLI end to end on the job DB (import, `import_exists`, `import_needs_safe_send_scope`, `--replace`, `file_unreadable`; output holds only the org id and counts); 37 worker mutations killed and three of the reviewer's killed; test 4 deviation accepted (a same-DB import is refused, test 4 uses `elsewhere()`).

Notes:
- N1: full-width `＠`, `%40`, `&#64;` and a bare `@gmail.com` passed the old scan (closed by the repair).
- N3: the export reuses only stage 14 guard 1 (the exact org name); guards 2 and 3 are replaced by the address scan and the host check. Optional: refuse a mailbox row whose address is not `LAB_TARGETS.demo.mailbox`.
- N5: the schema check does not catch a new text or uuid column that holds a row id without an FK (current such columns are Message-ID or hash keys with no row ids). Old user ids in `audit_log.actor` map only when the same id is in a `userRefs` column.
- N4: the seed file has no size limit (the operator supplies it).
