# F128 review notes (coordinator)

Opus review 1 (job 2026-11-15-f128-review-opus-2fa-off-new-cod-0fc88304): FAIL, one blocking (test 5c), fixed. Opus re-review of the delta (job 2026-11-15-f128-re-review-delta-opus-atomic-ae3e57b8): PASS. NOTE items, not fixed:
- N1: on an expired lock the hook clears the count with no `lockedUntil <= now` guard; parallel requests could reset the count after others reserved tries. Hardening: guarded `incrementOne`.
- N2: `lockAfterLastTry` writes the `web.two_factor_locked` row even when its guarded update matched no row (right code in parallel cleared the count first). False lock row in that race only.
- N3: a right code that clears the count also wipes in-flight reservations.
- N4: a thrown `clearCount` after a reservation leaves the try counted; a thrown `releaseTry` hides the original error.
- TG-a: the panel wrapper test does not prove `TwoFactorSection.tsx` uses the wrapper; only e2e does. TG-b: test 14 could assert exactly 10×401 and 5×429.
- Ticket text "an SSO session is unaffected": the code asks an SSO session of a user with TOTP on for the code, like any session (ADR 0026 amendment). Owner to confirm.
- Left for the deploy: lint and e2e on the merged tree (worker ran both on its own tree: 126 e2e passed); owner check in the panel after the deploy.
