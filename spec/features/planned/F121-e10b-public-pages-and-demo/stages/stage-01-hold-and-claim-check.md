# F121 stage 01 — Publication hold and claim check

Part of [`../plan.md`](../plan.md). `[risky]` publication path. Decisions D1, D2. Interfaces: `interfaces.md` § Docs app (stage 01).

Carry-over reads: ADR 0030 (§ Built), `apps/docs/scripts/deploy-gate.ts` and its test, `.github/workflows/docs-deploy.yml`, `apps/docs/src/in-place.ts` (`REPO_URL`, `docsGitRef`), `apps/docs/integrations/link-check.ts`, `docs/legal/claims.md` (head: how `gap` and `unverified` mark a source).

This stage must land before any F121 page: it is the hold that keeps new pages private.

## Step 1 — The hold

**Goal.** A pushed release tag does not publish the docs while a page waits for the owner.

**Files.** New `apps/docs/src/publish-gate.ts` and test; `apps/docs/scripts/deploy-gate.ts` and its test; a comment line in `docs-deploy.yml` if the gate step needs the list (the gate script reads the TS constant from the checked-out ref, no new workflow input).

**Decisions.**
- `OWNER_REVIEW_PENDING = ["index", "security", "pricing"]` now. A page id that has no page yet is allowed (stages 02–04 add them); stage 11 test checks every id is a real page.
- The hold is checked after every other rule: an older tag still says "not the newest"; a tag without a changelog release is still a red `changelog_missing`.
- Manual runs ignore the hold: the owner runs them, and a manual run is the rollback path.
- The skip writes the reason to the job summary like the other skips.

**Test.**
1. Newest tag `v0.3.0`, changelog has `0.3.0`, pending `["security"]` → `deploy: false`, reason `skip: owner_review_pending security`, no `error`.
2. Same, pending `[]` → `deploy: true`.
3. Pending `["security"]`, event `workflow_dispatch` on `master` → `deploy: true`.
4. Pending `["security"]`, tag `v0.3.0` with no changelog release → `error: changelog_missing 0.3.0` (the error wins).
5. Pending `["security"]`, older tag → reason "not the newest release" (unchanged).
6. `publishHoldReason(["index","pricing"])` = `owner_review_pending index pricing`; `publishHoldReason([])` = null.

Mutation: remove the pending check in `deployDecision` → test 1 fails.

## Step 2 — Claim type and check

**Goal.** The security page can only cite a proof that exists and a ledger row that is not weak.

**Files.** New `apps/docs/src/security/claims.ts` (with `publicClaims = []`) and test; new `apps/docs/integrations/claim-check.ts` and test; `apps/docs/astro.config.mjs` (add the integration next to `linkCheck`).

**Decisions.**
- Ledger parse: a row is `| C<3 digits> | claim | source | condition |`; the source cell is weak when its trimmed text starts with `gap` or `unverified` (any case). Parse only rows that match; a missing file throws.
- A claim needs at least one proof (`no_proof`) and at least one ledger id. Proof paths are files or folders that exist in the checkout; no `..`, no absolute path, no URL (`proof_missing`).
- The integration runs in `astro:build:done`, fails the build with all problems in one error, and logs `claim_check ok <n>`.

**Test.** With a temp root holding `docs/legal/claims.md` rows `C001` (source `ADR 0003`), `C002` (source `gap: …`), `C003` (source `unverified — …`) and a file `a/b.ts`:
7. Claim `x` ledger `[C001]`, proofs `[a/b.ts]` → `[]`.
8. Proofs `[a/missing.ts]` → `["claim x proof_missing a/missing.ts"]`.
9. Ledger `[C002]` → `ledger_weak C002`; `[C003]` → `ledger_weak C003`; `[C999]` → `ledger_missing C999`.
10. Proofs `[]` → `no_proof`; two claims with id `x` → `duplicate_id`; proof `../etc` → `proof_missing ../etc`.
11. `proofUrl("docs/decisions/0003-x.md", "v0.3.0")` = `https://github.com/Artexs/email_assistant/blob/v0.3.0/docs/decisions/0003-x.md` (use `REPO_URL`).
12. The integration with one bad claim throws; with none, it logs `claim_check ok 0`.

Mutation: drop the `gap` branch of the weak rule → test 9 fails.

**Check.** `bun test apps/docs/src apps/docs/scripts apps/docs/integrations`.

**Done when.** Tests 1–12 pass, `bun run docs:build` logs `claim_check ok 0`, and the Proof prints `PROOF_OK`.

**Out of scope.** Claim rows (stage 02); any change to `docs/legal/claims.md` or the registry.
