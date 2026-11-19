# F137 · Questions and owner steps

No blocking question. Each item has the default the plan uses. The coordinator copies the `[important]` items to `docs/owner-decisions.md` when it lands the plan.

## Defaults (owner to confirm)

- **Q1** [important: privacy] An address written in NFD (`Jose` + U+0301) and the same address in NFC (`José`) stay two addresses for the erase (D5). An erase request for one spelling leaves mail stored in the other. Default: keep; the operator runs the erase once per spelling that `--find` shows. Other option: a new ticket adds NFC to the one address rule (changes every profile key hash, so it needs a rehash of `sender_profiles`).
- **Q2** [important: privacy] Find and erase refuse with `rule_mismatch` when the database lower-cases a letter of the asked address (or a whitespace character) unlike the program (D7). Default: yes, refuse; nothing changes; the operator runs `--rule-check` and tells the owner. Other option: no run-time check (an image with another glibc then over- or under-matches in silence).
- **Q3** [important: privacy] The `postgres:17` image lower-cases 28 new letters (U+A7CE, U+A7D2, U+A7D4, U+16EA0–U+16EB8; Unicode 16 and 17) unlike Bun (D8, review B1). Default: no SQL fix map; an erase of an address that holds one of them refuses (Q2). No real address is expected to hold them. Other option: a fix map in the SQL form (it must follow the floating image tag and Bun upgrades).
- **Q4** [minor] The whitespace set is exactly what JS `trim()` strips (25 code points, D1). U+0085 (NEL) and U+200B (zero width space) are not stripped, because JS does not strip them; `normalizeDsrAddress` already rejects an asked address that holds them.
- **Q5** [minor] The check of D7 compares all code points at each find and erase: about 1 s (review G2 measured 0.8 s for the query). No flag. The set is cached for the life of the process: one CLI run is one process, so an image change shows at the next run, and the integration suites (hundreds of find and erase calls) pay the second once.

## Owner steps

None. No migration, no flag, no deploy step, no `TERMS_VERSION` bump.

## Gates

- Build after F135 (landed).
- Stages 02, 03 and 04: an Opus review before the land (plan.md § Review).
- After the deploy of stage 04 (whoever runs VPS commands under the deploy runbook; read-only): run `org:dsr --rule-check --org-id <pilot org>` on the VPS once and file the output in the ticket folder; more than the 28 letters of Q3 is a question for the owner.
