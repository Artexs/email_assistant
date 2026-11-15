# F102 stage 14 review (Sonnet 5.5, PASS 9725b4cf)

Model: Sonnet 5.5, because the stage has no migration and no new UI text (API, flag-gated); tenancy attacked with RLS on and off.

No BLOCKING. All 8 attack points hold (flag before role, owner-only writes, address never changes, org isolation, audit data without names/tags/address, `setDelegateActive` has no other caller, list bounds, no migration or lock change).

TG1 (proven by mutation, fixed in a Sonnet continue): no committed test covered the `lockDelegate` row lock. Added: "two PATCH at once gives one audit row" loop and "held lock blocks `updateDelegate`" test.

Notes:
- N1: CLI audit row of `delegates:disable/enable` is now `{delegate_id, fields:"active", active, via:"cli"}` (was `{delegate_id, active}`); no reader.
- N2: `updateDelegate` validates name and tags before lookup: an invalid name on a foreign id gives 400, not 404 (leaks nothing).
- N3 (carry-over to stage 19 docs): `docs/capabilities/delegation.md` and `tenancy-and-plans.md` need the three routes and the `delegation_pages` flag. `fields` in `delegate.changed` is a comma string (flat audit data); no audit viewer reads it.
- N5: route test T12 passes without the `org_id` filter because RLS blocks too; the repo-level tests carry the filter proof.
