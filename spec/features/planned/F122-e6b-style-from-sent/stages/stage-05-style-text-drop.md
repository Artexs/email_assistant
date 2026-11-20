# F122 stage 05 — Drop `organizations.style_text` `[risky]`

Part of [`../plan.md`](../plan.md). Needs the release that carries stage 04 (the code with no read of the column is live on the VPS; R1). Never next to another migration in build.

The contract half of PD-079: the column goes, and every map that names it goes with it.

## Step 1 — The contract migration

- **Goal:** one dbmate file `db/migrations/YYYYMMDDHHMMSS_drop_style_text.sql` that drops `organizations.style_text` (and its CHECK, if it has one), with the line `-- contract: v<x.y.z>` where `v<x.y.z>` is the release tag that carried stage 04 (ask the coordinator in the final message if it is not in `CHANGELOG.md`; do not guess). Then `bun run db:types`.
- **Decisions:** D13. Forward-only (PD-053): the down part has the repo's forward-only comment. The copy of stage 04 ran before; this migration copies nothing.
- **Test:**
  1. `bun run db:check-migrations` passes with the `-- contract:` line, and fails with the line removed (run once, then restore).
  2. Integration: an organization insert with the fields of `createOrganizationWithOwner` works; the export of an organization holds no `style_text` key.

## Step 2 — Maps and docs

- **Goal:** remove the exclusion entry of stage 04 from the privacy maps, and the column from the legal data categories (if listed there), the `delete_organization` function body (if it names the column) and the capability pages (`tenancy-and-plans.md` table, `account-data.md`, `retention.md` if named). Regenerate `docs/api/openapi.json` if it still lists the field.
- **Decisions:** the privacy completeness tests (every text column is classified) must pass with no entry for the dropped column. Tests of applied migrations that seed or read the column cannot run after the drop: delete the cases that do (the F115 round-trip cases of `reply-drafts-schema.test.ts` that re-run the Up part of `20261117130001_reply_drafts.sql`, and the copy test of stage 04), keep every other case of those files, and list each deleted case with its reason in the final message. Rejected: a test that runs migrations only up to a version (no such helper; the behaviour they proved is history).
- **Test:**
  1. The privacy map tests pass with the column gone (they fail when an entry names a column that does not exist: check that one fails before the map edit, then passes).
  2. A check that must find nothing: `rg -n "style_text|styleText" apps packages docs/capabilities` finds nothing outside `db/migrations/` and the 400 test of stage 04.
- **Check:** `bun run db:migrate` and `bun run db:migrate:e2e` on the job DBs, the touched tests, then the Proof (the full suites run, because a migration changed).
- **Done when:** the tests pass; the Proof line is PASS. Owner step after land: none; the coordinator runs the next release as usual.
- **Out of scope:** any other column of `organizations`.
