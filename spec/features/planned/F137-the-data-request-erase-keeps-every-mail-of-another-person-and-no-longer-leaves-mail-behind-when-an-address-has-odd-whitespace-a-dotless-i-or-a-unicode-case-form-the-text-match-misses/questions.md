# F137 · Questions and owner steps

No blocking question. Each item has the default the plan uses. The coordinator copies the `[important]` items to `docs/owner-decisions.md` when it lands the plan.

## Defaults (owner to confirm)

- **Q1** [important: privacy] An address written in NFD (`Jose` + U+0301) and the same address in NFC (`José`) stay two addresses for the erase (D5). An erase request for one spelling leaves mail stored in the other. Default: keep; the operator runs the erase once per spelling that `--find` shows. Other option: a new ticket adds NFC to the one address rule (changes every profile key hash, so it needs a rehash of `sender_profiles`).
- **Q2** [important: privacy] Find and erase refuse with `rule_mismatch` when the database `lower()` disagrees with the program rule (D7). Default: yes, refuse; nothing changes until the operator fixes the database locale. Other option: no run-time check (an erase on a database with another locale then under-matches non-ASCII addresses in silence).
- **Q3** [important: privacy] If the CI database (`postgres:17`) lower-cases a letter unlike JS (D8). Default: JS wins; a fix map goes into the SQL form and stage 02 goes on. Other option: stop the ticket and ask.
- **Q4** [minor] The whitespace set is exactly what JS `trim()` strips (25 code points, D1). U+0085 (NEL) and U+200B (zero width space) are not stripped, because JS does not strip them; `normalizeDsrAddress` already rejects an asked address that holds them.
- **Q5** [minor] Stage 04 runs about 3,000 probe strings in one query before each find and erase (D7): a few milliseconds. No flag.

## Owner steps

None. No migration, no flag, no deploy step, no `TERMS_VERSION` bump.

## Gates

- Build after F135 (landed).
- Stages 02, 03 and 04: an Opus review before the land (plan.md § Review).
