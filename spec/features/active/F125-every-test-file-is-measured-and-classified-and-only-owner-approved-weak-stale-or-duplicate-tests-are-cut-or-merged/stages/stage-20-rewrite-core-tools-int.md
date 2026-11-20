# F125 stage 20 — G10: weak core, fake Telegram and integration cases get exact asserts

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts` (mutant compare); F154 stage 12 landed or closed: it writes `packages/core/src/notices/encode.test.ts`. May run next to 09–19. Gets a review job on `claude-opus-5-5` (plan § Review: the int rows test SSO, mailbox OAuth login and sender trust).

Group G10 (`REWRITE-WEAK`, owner `ok`). Rows with the proposed assert: `audit/review-core-web-tools.md` (`notices/encode.test.ts:100`, `:104`, `tools/fake-telegram/src/compat.test.ts:44`) and `audit/review-int-e2e.md` rows 21, 31, 89, 90 (`mail-oauth-login.test.ts:29`, `sso-schema.test.ts:152`, `mail-connect.test.ts:324`, `trust-repo.test.ts:86`). Follow plan § Cut stage steps (S1–S7) and D23 (stage 19).

## Rows of this stage

`cut-keys --group G10`: 7 keys in 6 files (2 core, 1 tool, 4 integration).

## Step 1 — Core and fake Telegram rows

- `notices/encode.test.ts` (2 rows): replace `not.toThrow()` with the exact encoded value or the exact refusal.
- `tools/fake-telegram/src/compat.test.ts:44`: the exact value the compat call returns.

## Step 2 — Integration rows

- `sso-schema.test.ts:152`: after the insert of an https issuer, read the row back and assert its exact stored values (the row proposal).
- `mail-oauth-login.test.ts:29`: `verifySmtpLogin` returns `Promise<void>`; assert `resolves.toBeUndefined()` together with one exact observable effect from the row proposal (for example the exact login the fake server saw), so the case fails when the login is skipped.
- `mail-connect.test.ts:324` and `trust-repo.test.ts:86`: the exact values of the row proposals.
- Each int case keeps its transaction and rollback shape.

## Proof (S5)

- **D14** (stage 16) for the core part: `mutation.sh --mutate` with the import closure of `notices/encode.test.ts` before the first edit and after the last commit. Each Stryker run starts with a dry run of the whole core suite: that is the audit tool, the one allowed full-suite run (plan D14), not `test:unit`.
- `cut-run` before twice and after once on the 6 files; `cut-proof --expect unit=+0,int=+0` with both `mutation.json` files. A rewrite may add kills; it must not lose one.
- An empty `diff` of the sorted JUnit `name` lists before and after.
- D23 rule 4: break once per row; for the int rows, break the code under test (for example skip the issuer insert), never the schema.

## Out of scope

- Any product code, migration or schema change.
- Other weak int cases that are no G10 key.

## Done when

- `audit/cut-s20.md` holds the 7 rows with old assert, new assert and break-once result, the deferred rows, the glob list, the `cut-proof` PASS section and the empty name diff.
- One commit, message `F125 G10 REWRITE-WEAK: exact asserts in core, fake Telegram and integration cases`.
- Last step: `bun run check:job`; copy its last line.
