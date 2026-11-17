# Flaky: channels-digest-brief-race "10 days: two queue transactions at different slots"

- 2026-11-17, job `2026-11-17-f107-s02-legal-page-frame-032dd9b8`: failed once in the first full int chain (got 2, expected 1), passed 3 of 3 alone and in the second full chain. Another job ran a full int suite on the same GreenMail and DB at the time. Cause not shown; load is a guess.
- If it fails again in CI, open a ticket. Stage 19 changed the first-digest-of-the-day rule (slot date) and rewrote related tests; check that file first.
