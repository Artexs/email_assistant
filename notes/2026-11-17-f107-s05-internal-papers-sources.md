# F107 stage 05: internal papers, sources and open placeholders

Files: `docs/legal/records-of-processing.md`, `docs/legal/dpia.md`, `docs/legal/breach-procedure.md`, `docs/legal/README.md`. Test: `apps/server/src/legal-papers.test.ts`. Stage 06 builds `docs/legal/claims.md` from this note and from the notes of stages 03 and 04 (`notes/2026-11-17-f107-s03-privacy-sources.md`, `notes/2026-11-17-f107-s04-terms-dpa-sources.md`).

## Open placeholders (all `<to confirm: …>` except the listed ones)

- Records: `<provider name>`, `<address>`, `<contact>`, `<organization name>`, `<backup retention>` (allowed list); `<to confirm: Art. 30 wording checked>`, `<to confirm: representative and data protection officer>`, `<to confirm: legal basis>`, `<to confirm: transfer mechanism>`, `<to confirm: location>`, `<to confirm: B2 region>`, `<to confirm: record of the audit trail>`.
- DPIA: `<to confirm: Art. 35(7) wording checked>`, `<to confirm: number of organizations, mailboxes and members>`, `<to confirm: assessment of automated decisions>`, `<to confirm: transfer mechanism>`, `<to confirm: legal basis>`, `<to confirm: views of data subjects>`, `<to confirm: advice of the data protection officer>`, `<to confirm: OpenAI terms check date>`, `<to confirm: VPS disk encryption>`, `<to confirm: DPIA decision>` (required by the stage), `<to confirm: DPIA decision date>`.
- Breach procedure: `<to confirm: Art. 33 and 34 wording checked>`, `<to confirm: breach detection beyond availability alerts>`, `<to confirm: CREDENTIALS_KEY rotation steps>`, `<to confirm: bot token revoke steps>`, `<to confirm: rotation of other keys>`, `<to confirm: how to count the people of one organization>`, `<to confirm: risk test for the notice duties>`, `<to confirm: 24 hours target>` (Q9), `<to confirm: contact channel of the owners>`, `<to confirm: Art. 33(3) wording checked>`, `<to confirm: Art. 33(1) and the authority checked>`, `<to confirm: Art. 34 wording checked>`, `<to confirm: breach register location>` (Q5).

## Deviation from the stage text

The stage writes the register location as `<breach register location>`. That form is not in `legalPlaceholders` (`apps/web/src/lib/legal.ts`). The papers use `<to confirm: breach register location>`, which the allowed list accepts. Test 5 of `legal-papers.test.ts` reads that list and fails on any other `<…>` token.

## Statement and source (weak ones marked)

| Statement (short) | Source |
| --- | --- |
| Two roles: controller of member account data, processor of the mail | `docs/product/stage-2/epics/E07-discovery-notes.md` §4; privacy and DPA pages. Weak: a plan decision. |
| Which categories are account data (record A): `account`, `sign-in-tokens`, `chat-links` | Privacy text, section "What data", item "Members". Judgement of the writer; `audit` stays in record B (one table). |
| Category tables, subjects, kept periods | `packages/core/src/legal/data-categories.ts` (the rows are copied from it; test 1b checks tables and day counts) |
| Recipients and transfers | `packages/core/src/legal/subprocessors.ts` |
| Healthchecks pings, backup check, `ops.slo` alert list | `deploy/README.md` § Heartbeat, § Backups; ADR 0024 point 6 |
| No alert detects a leak | Derived from the list of ADR 0024 point 6 (sync lag, urgent latency, LLM failure rate, disk, backup age). Weak: a reading, not a doc line. |
| Contain: stop, rollback, end sessions | `deploy/README.md` § Heartbeat (`$C stop server`), § Roll back a release, `docs/capabilities/backups.md` rule 5 |
| Rotation of `CREDENTIALS_KEY`, `WEB_AUTH_SECRET`, bot token, mailbox passwords | `deploy/README.md` § VPS lost step 3 and 6, § Telegram; `docs/architecture.md` §7; ADR 0009; `docs/capabilities/sync.md`. No rotation runbook exists for the key and the bot token: placeholders (E8b). |
| 24 hours target for the processor notice | F107 question Q9 (default). Weak: a default. |
| 72 hours, UODO, Art. 34 high risk | Stage 05 file. Weak: no law text read (stage 06). |
| Breach register outside the repo; entry holds facts, effects, measures | F107 question Q5; Art. 33(5) from the stage file. Weak: no law text read. |
| Risk measures R1 to R8 | The table "Measures" of `docs/legal/dpia.md`: each row lists its ADR, capability page or test. |

## Risk levels chosen (writer's draft; the controller confirms)

Before measures (L = likelihood, S = severity): R1 LLM in the US high/high; R2 Telegram high/medium; R3 prompt injection medium/high; R4 wrong automatic move medium/medium; R5 wrong recipient low/high; R6 stolen VPS or backup low/high; R7 missed `org_id` filter low/high; R8 mailbox secret lost or leaked low/high.

After measures: R1 medium/high; R2 medium/medium; R3 low/medium; R4 low/medium; R5 low/medium; R6 low/high; R7 low/medium; R8 low/medium.

## For stage 06

- "A lost mailbox secret" (stage text) is read as both a leak of the secret and a loss of `CREDENTIALS_KEY` (ADR 0009 names both consequences). Confirm the reading.
- The papers cite no `spec/` path (the capability map test skips them, so do the legal paper tests). The claims list should give each claim a `docs/`, `apps/`, `packages/` or `deploy/` source.
- Doc conflict still open (stage 04 carry-over): `docs/capabilities/tenancy-and-plans.md` rule 2 says no row-level security; the DPIA follows `docs/architecture.md` §5 and §7 and cites the migration `db/migrations/20261114100002_rls_tenant_policies.sql` and `apps/server/test/integration/rls-policy.test.ts`.
