# F137 stage 01 — Tests that kill the six surviving mutations

Part of [`../plan.md`](../plan.md). Not risky: tests only, no product code.

Carry-over reads: `apps/server/test/integration/privacy-dsr-address-rule.test.ts` (fixtures and the `CASES` style), `apps/server/src/modules/privacy/dsr-match.ts` (`findMails`, the own-address check), `apps/server/src/modules/contacts/address-sql.ts`, the F135 review result `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-19-f135-review-erase-address-rule-6006ca65/result` (TEST GAP 1–4). Decision: D9.

## Step 1 — the gap tests

- Goal: committed tests that fail under each mutation of Step 2 and pass on the code at `HEAD`.
- Files: `apps/server/test/integration/privacy-dsr-address-rule.test.ts` (a new `describe` block). No other file, except a fixture helper if one is missing.
- Values are written with `\u` escapes in the test (Σ U+03A3, σ U+03C3, ς U+03C2, İ U+0130, combining dot U+0307, ı U+0131).
- Test:
  1. **Only party besides own mailboxes, non-ASCII.** Own mailbox `boxς@x.gr`. One mail: From `BOXΣ@x.gr`, To `[annaς@x.gr]`, no Cc. One mail From `other@x.test` (control). Find `ANNAΣ@x.gr` counts 1 mail. Erase `ANNAΣ@x.gr` → kind `erased`; the first mail is gone; the control mail stays.
  2. **Same branch through Cc.** As 1, but To `[boxς@x.gr]` and Cc `[ANNAΣ@x.gr]`, From `boxσ@x.gr`. Erase `annaσ@x.gr` → the mail is gone.
  3. **Dotted capital I written by JS.** Store `"İLKER@x.tr".trim().toLowerCase()` (that is `i̇lker@x.tr`, the way `triage/newsletter-unsubscribe.ts` writes `sender_lower`) as an `unsubscribe_requests` row. Find `ILKER@x.tr` → `mentions["unsubscribe_requests.sender_lower"]` is 1. Erase `ILKER@x.tr` → the row is gone.
  4. **Member e-mail written by JS.** A member whose `users.email` is `"İLKER@x.tr".trim().toLowerCase()` (the way `tenancy/members.ts` writes it). Find `İlker@x.tr` → kind `own_address`.
  5. **A real plus tag.** Mails From `annaσ+tag@x.gr` and From `ANNAΣ@x.gr`, and a kept mail From `other@x.test` with To `[annaσ+tag@x.gr]`. Erase `annaσ@x.gr` → the `+tag` mail stays; the To list of the kept mail is still `[annaσ+tag@x.gr]`; the `ANNAΣ` mail is gone.
  6. **A longer address keeps its mail.** Mails From `annaσ@x.gr.pl` and From `annaς@x.gr`. Erase `annaσ@x.gr` → only the `.gr.pl` mail stays.
  7. **Near addresses keep their mail.** Mails From `annaς@x.gr` and `ILKER@x.tr`, plus one mail from each of: `annas@x.gr`, `αννα@x.gr`, `annaσ+tag@x.gr`, `ılker@x.tr`, `ilker.@x.tr`, `i.lker@x.tr`, `ｉlker@x.tr`, `ilker@x.tr.`, `ilker@xn--x.tr`, `annaσ@x.gr.pl`. Erase `ANNAΣ@x.gr`, then `İlker@X.TR` → exactly the ten near senders stay.
- Check: `bun test apps/server/test/integration/privacy-dsr-address-rule.test.ts` passes.
- Done when: all tests pass at `HEAD`.

## Step 2 — the mutation run

- Goal: show that each mutation fails a test of Step 1. Edits are in `dsr-match.ts` (`findMails`) or `address-sql.ts`. Apply one at a time, run the test file, restore (`git checkout -- <file>`), check `git status` is clean.
  - **M06**: in the To/Cc `exists` of `findMails`, compare `lower(v)` instead of the normalized `v`. Expect test 1 to fail.
  - **M07**: in the `not exists … <> address` of `findMails`, compare `lower(v) <> address` instead of the normalized `v`. Expect test 1 or 2 to fail.
  - **M08**: in the `own` CTE of `findMails`, aggregate `lower(address)` instead of the normalized address. Expect test 1 to fail.
  - **M22**: in `normalizedAddress`, drop the `'i' || chr(775)` → `'i'` replace. Expect test 3 or 4 to fail.
  - **M24**: wrap `normalizedAddress` in `regexp_replace(…, '\+[^@]*@', '@')` (strips a plus tag). Expect test 5 or 7 to fail.
  - **M25**: in `findMails`, compare the sender with `like address || '%'` instead of `=`. Expect test 6 or 7 to fail.
- A mutation that survives is a gap: add a test case that kills it, then run it again. Do not weaken a mutation.
- Done when: the result lists M06, M07, M08, M22, M24 and M25, each with the failing test name and a log path, then the Proof (plan.md, `NN` = `01`) prints `PROOF_OK`.

## Out of scope

Product code. The whitespace set and the regex (stages 02 and 03).
