# Org delete fails when RI trigger OIDs cross a digit boundary (2026-11-13, F088 stage 06)

Observed: in a fresh job DB (`db:worktree`), every test of `mail-remove.test.ts` failed in `afterEach`
(`DELETE FROM organizations` → FK `delegations_delegate_id_org_id_fkey` on `delegations`, code 23503).
Also at HEAD without any change. `psql`: `begin; delete from organizations where id = <org with a delegation>;` gave the same error.

Cause (verified): Postgres fires the RI cascade triggers of one table in the order of their NAME, as text.
Names are `RI_ConstraintTrigger_a_<oid>`. In that DB the mailboxes trigger was `..._99885` and the delegates trigger
`..._100210`; as text, `100210` sorts before `99885`, so `organizations → delegates` ran before `organizations → mailboxes → emails → delegations`.
`delegations.delegate_id` is NO ACTION, so the delete failed. The result depends on the OID counter of the server when the DB is migrated.

Fix used: made a new job DB (`bun run db:worktree <new-name>`), where all OIDs have six digits. Then 89 of 89 tests passed.
The code risk: deleting an organization that has a delegation can fail on a server whose OID counter is near a digit boundary.
This matters for E7-T3 / S6c (organization delete): give `delegations.delegate_id` `ON DELETE CASCADE`, or delete delegations first.
Note for builders: when `mail-remove.test.ts` fails in `afterEach` with this FK error, make a new job DB.
