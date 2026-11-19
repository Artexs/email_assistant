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

## Re-review (Opus narrow, PASS 5a97fd5c, landed at 06d62992)
B1 and TG1 closed. The scan refuses 11 forms in export and import, 48 hidden-character and double-encoded forms, and runs in linear time (5 MB in under 0.4 s); all 250,029 strings of lab-01 pass and the whole lab week exports and imports. `--replace` refuses an org with an active mailbox, a real secret, no credential row or no mailbox.

Notes (carry to stage 16 docs):
- Some exotic forms still pass the scan: `&#64` and `&#x40` with no semicolon, `=40` quoted-printable, RFC 2047 words, the encoded full-width at sign after NFKC, `(at)` forms. None is a plain address. Optional: NFKC again after the decode, and accept entities without the semicolon.
- 24.8 says "never deleted" for a renamed real org: too strong (a zero-mailbox org of only the `--email` user with a zero-mailbox seed; the in-transaction `expect` reads addresses and members only, not status or secret). Reword to "refused unless every mailbox is a paused import placeholder".
- A bare `@` in live LLM text fails the export (fails safe); run the export once on the real lab week before C6.
