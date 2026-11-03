# Bun timezone list is incomplete

- Found 2026-11-03 in the S0 stage 5 review.
- Under Bun 1.3.14 (JavaScriptCore), `Intl.supportedValuesOf("timeZone")` has 445 entries. It has only old aliases for some zones.
- Accepted: `UTC`, `Europe/Warsaw`, `America/New_York`, `Europe/Kiev`, `Asia/Calcutta`.
- Rejected: `Europe/Kyiv`, `Asia/Kolkata`, `Etc/UTC`, `GMT`. Postgres 17 accepts all of them.
- `apps/server/src/modules/tenancy/service.ts` uses this list to check the organization timezone (S0 plan decision). Pilot default `Europe/Warsaw` works.
- Possible fix (when a user needs such a zone): `new Intl.DateTimeFormat("en", { timeZone: tz })` in a try/catch. Under Bun it accepts the names above and rejects `Mars/Base` and `""`. Store `resolvedOptions().timeZone` to normalize the case.
