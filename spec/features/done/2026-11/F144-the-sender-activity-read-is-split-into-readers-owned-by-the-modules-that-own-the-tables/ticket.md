---
opened: 2026-11-19
landed: 2026-11-20
---

# F144 · The sender activity read is split into readers owned by the modules that own the tables

## Outcome

The 90-day sender activity read of the sender profile pass stops running its own SQL over the tables of the mail, triage and delegation modules. Each of those modules exports typed readers over its own tables, and the contacts module only composes their rows. A column change in one of those tables now fails the typecheck or that module's own tests, not the profile pass in silence. Profiles, suggestions and the sender line give the same numbers as before.

## Scope

- Starting seam: `readSenderActivity` in the contacts module (quality pass 2, finding 4).
- A characterization test that fixes the whole output and the statement count of today's read, before any move.
- Mail readers: the incoming-mail window, the counts of incoming mail with flags and headers, the own addresses, the Sent counts and the reply delays.
- Triage readers: the newest result and the newest feedback per sender. Delegation reader: delegations per delegate address.
- The contacts read keeps its signature and output; a scan test keeps raw SQL out of it.

## Out of scope

- Other cross-module reads in contacts: the data request address list (`contacts/privacy.ts`) and the mailbox reads of the suggestion commands.
- The F100 metric readers that join `emails` from another module.
- Any change of a count, a window or a relation rule; any migration or index.
- The split of the delegation repository by aggregate (another ticket of quality pass 2).

## Acceptance

- The characterization test passes unchanged at every stage: the same output for the full pass and both scopes, and the same statement count.
- Each new reader has an integration test with fixed values and a test that a second organization's rows never count.
- `contacts/activity.ts` holds no `sql` template, no `selectFrom` and no `.execute(` (scan test), and has under 400 lines.
- `layers.json` names the contacts → triage edge, and `bun run lint` passes.
- `docs/capabilities/sender-context.md` names the readers and their modules.

## Slices

Six stages, one worker job each: 01, then 02, then 03, 04 and 05 in parallel, then 06. No migration, no `bun.lock` change. Detail: `plan.md` § Stages and § How to run.

## Sequenced

Plan after: F142 (its stage 01 writes `normalizeAddress` in `@ea/core` and `normalizedAddress` in `apps/server/src/platform/db`; its stages exist).
Build after: none in `done/`. Stages 02–06 need F142 stage 01 landed (their Needs lines). Overlap: the file split ticket of quality pass 2 (F143) must leave `contacts/activity.ts` to this ticket; on a land conflict in `delegation/` or `mail/repo/`, the later job merges master and re-proves.
Gate: none.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 4. Scouts: `scouts.md`.
