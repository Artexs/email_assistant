# fake-telegram: facts from the live run (2026-11-07)

Task: `spec/features/done/2026-11/F035-fake-telegram/plan.md` (step 6.2, section "## Results"). Usage: `tools/fake-telegram/README.md`.

## Own database for a live run

- A live run uses its own database `email_assistant_faketg` on the dev Postgres, and the server on `PORT=8081`.
- Reason: another session runs `test:int` on the shared dev DB again and again. A dev server on that DB would break the "Shared runtime" rule.
- Side effect: no other linked dev chat is in the own DB. No outbox row of a real dev chat fails.
- The roles `migrator` and `app` belong to the cluster. The new database needs only the grants of `db/roles.sql` (`GRANT CONNECT`, schema grants). Then run `db:migrate` with `MIGRATOR_DATABASE_URL`.
- Drop the database at the end.

## org:create e-mail rule

- The user e-mail (`--email`) must be a valid address. `u-<uuid>@localhost` gives "Invalid email address".
- The mailbox address (`mailbox:connect --address`) can be the GreenMail user `u-<uuid>@localhost`.

## Docker port check

- Docker's proxy can hide port 5433 (Postgres) from the `ss -ltn` output. In this run `ss -ltn` showed no 5433 line, and a TCP connect to 5433 worked.
- To test a port, open a TCP connect to it. Do not trust `ss -ltn`.

## Bun env priority

- Bun gives shell env keys priority over `.env`. The live run confirmed it: the overrides of `DATABASE_URL`, `PORT` and `TELEGRAM_API_ROOT` worked.

## LLM and timing

- The real LLM (`LLM_PROVIDER=openai`, classifier `gpt-6-luna`) gave `urgent` for the seed text (`appendUrgentSeed`). It needed 1 classifier call.
- The urgent notice came about 100 s after the seed. The mail sync interval causes most of this time.

## Quiet hours in tests

- The channel sender holds every notice except the digest in quiet hours: 22:00–07:00 in the org time zone (`QUIET_HOURS` in `packages/core/src/digest/local-time.ts`, check in `apps/server/src/modules/channels/sender.ts`). The org default zone is Europe/Warsaw.
- A test or a live run that waits for a notice at the real time fails each evening and night. The e2e test sets the org zone with `timeZoneOutsideQuietHours` (`tools/fake-telegram/test/setup.ts`). For a live run after 22:00 Warsaw time, set `organizations.timezone` of the run org to `Etc/UTC` or `Etc/GMT-12`.
