# F121 stage 01 — Publication hold and claim check

Needs: nothing new; it reads `deploy-gate.ts`, `docs-deploy.yml` and `docs/legal/claims.md` at HEAD. May run next to 08.

Part of [`../plan.md`](../plan.md). `[risky]` publication path. Decisions D1, D2. Interfaces: `interfaces.md` § Docs app (stage 01).

Carry-over reads: ADR 0030 § Built, the deploy gate and its script-level test, `apps/docs/src/in-place.ts` (`REPO_URL`, `docsGitRef`), the link check integration, `flagged-text.test.ts`.

It lands before any F121 page: it is the hold that keeps new pages off the site.

## Step 1 — The hold

**Files.** New `apps/docs/src/publish-gate.ts` and test; `apps/docs/scripts/deploy-gate.ts` and test; `docs-deploy.yml` (one dispatch input).

**Decisions.**
- `OWNER_REVIEW_PENDING = ["index", "security", "pricing", "reference/api", "reference/autonomy-evidence"]`. An id without a page yet is allowed now; stage 12 checks each id is a page.
- `main` gets the list as a parameter whose default is the imported constant. No env override, no CLI flag: nothing outside a commit can lift the hold.
- Pushed tag: the hold is checked after every other rule (older tag still "not the newest"; missing changelog release still the red `changelog_missing`). Held → `deploy: false`, reason `skip: owner_review_pending <ids>`, no `error`.
- Manual run: a new boolean input `publish_held_pages` (default `false`; today `workflow_dispatch` has no input). It reaches the gate as env, like the `GATE_*` values, never inside the script text. List not empty and input false → the same skip. Input true → deploy (the owner's own act; also the rollback path). List empty → the input does not matter.

**Test.**
1. Newest tag `v0.3.0`, changelog has `0.3.0`, pending `["security"]` → `deploy: false`, reason `skip: owner_review_pending security`, no error.
2. Same, pending `[]` → `deploy: true`.
3. Pending `["security"]`, dispatch on `master`, `publish_held_pages` false → skip; true → `deploy: true`.
4. Pending `["security"]`, tag `v0.3.0` without changelog release → `error: changelog_missing 0.3.0`.
5. Pending `["security"]`, older tag → "not the newest release".
6. Script level: the existing real-script test passes `[]` through the `main` parameter and still sees `deploy=true`; a new real-script test with the default (the real constant) and a newest tag sees `deploy=false` and `owner_review_pending`.
7. `workflows.test.ts`: the dispatch input exists, type boolean, default false.

Mutation: `main` passes `[]` instead of the constant → test 6 fails.

## Step 2 — Claim type and check

**Files.** New `apps/docs/src/security/claims.ts` (`publicClaims = []`) and test; new `apps/docs/integrations/claim-check.ts` and test; `astro.config.mjs` (next to `linkCheck`); `flagged-text.test.ts`.

**Decisions.**
- Ledger row: `| C<3 digits> | claim | source | condition |`. **Weak** when the source cell holds the word `gap` or `unverified` anywhere (case-insensitive, word boundary), not only at the start (review 1 B1: 7 rows carry it mid-cell, for example C033, C036).
- A claim needs ≥ 1 ledger id and ≥ 1 proof. A proof is a repo path that exists (no `..`, no absolute path, no URL) and that a cited ledger row names in its source cell: the path, its file name, or `ADR NNNN` for `docs/decisions/NNNN-*.md`. Else `proof_not_in_ledger`.
- When a cited ledger row has a condition other than `—`, the claim's `condition` must not be null (`condition_missing`).
- The integration runs in `astro:build:done`, fails with all problems, logs `claim_check ok <n>`.
- `flagged-text.test.ts` also scans the `en` and `pl` text of `publicClaims` (review 1 N2).

**Test.** Temp root with `docs/legal/claims.md` rows `C001` (source `ADR 0003; a/b.ts`, condition `—`), `C002` (`gap: …`), `C003` (`unverified — …`), `C004` (`OpenAI terms … unverified: contract not in repo`), `C005` (source `a/b.ts`, condition `LLM_PROVIDER`), files `a/b.ts`, `docs/decisions/0003-x.md`, `a/c.ts`:
8. Claim `x`, ledger `[C001]`, proofs `[a/b.ts, docs/decisions/0003-x.md]` → `[]`.
9. Proof `a/missing.ts` → `proof_missing a/missing.ts`; proof `a/c.ts` → `proof_not_in_ledger a/c.ts`; `../etc` → `proof_missing ../etc`.
10. Ledger `[C002]`, `[C003]`, `[C004]` → `ledger_weak` each; `[C999]` → `ledger_missing C999`.
11. Ledger `[C005]` with `condition: null` → `condition_missing`.
12. Proofs `[]` → `no_proof`; two claims `x` → `duplicate_id`.
13. `proofUrl("docs/decisions/0003-x.md", "v0.3.0")` = `${REPO_URL}/blob/v0.3.0/docs/decisions/0003-x.md`.
14. The integration with one bad claim throws; with none, logs `claim_check ok 0`.

Mutation: weak rule back to "starts with" → test 10 (C004) fails.

**Check.** `bun test apps/docs/src apps/docs/scripts apps/docs/integrations`.

**Done when.** Tests 1–14 pass, `docs:build` logs `claim_check ok 0`, Proof prints `PROOF_OK`.

**Out of scope.** Claim rows (stage 02); edits to the ledger or the registry.
