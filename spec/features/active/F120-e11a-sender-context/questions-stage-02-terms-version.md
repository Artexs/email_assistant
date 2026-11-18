# F120 stage 02 · Question: the registry change needs a TERMS_VERSION entry

## Observed

Stage 02 adds the data category `sender-context` to `packages/core/src/legal/data-categories.ts`. The schema tests need it (`apps/server/test/integration/data-categories.test.ts` tests 5 to 7: every table is in a category or in `NO_PERSONAL_DATA_TABLES`; the address column `sender_suggestions.pattern` is a column with third-party addresses).

The unit test `apps/web/src/lib/legal-version.test.ts` test 2 ("the last TERMS_HISTORY digest equals the digest of the current texts") hashes the two registries. After this change it fails:

```
append a new TERMS_HISTORY entry in packages/core/src/web/terms.ts (digest of the current texts: 4c28889f8a7b2567b52b26b06c6be28b0cce5711298113425e32db6a2fd3673d)
Expected: "4c28889f8a7b2567b52b26b06c6be28b0cce5711298113425e32db6a2fd3673d"
Received: "19879c6e6fec34e7eac3f75d873be45400dcc8c048e0b88dae19d6c28c5eec5a"
```

Log: `unit.log` of the job (`f120-s02-logs/unit.log`): 6425 pass, 1 fail (this one).

Plan question Q2 and the job instruction say: add the category, do NOT bump `TERMS_VERSION`. Both assumed that a registry change does not move the digest. It does. So CI on `master` stays red after the land until the history gets an entry.

## Options

1. **Append the entry** (recommended if Q2 may change): in `packages/core/src/web/terms.ts` add `{ version: "2026-11-18", sha256: "4c28889f8a7b2567b52b26b06c6be28b0cce5711298113425e32db6a2fd3673d" }`. Every member then accepts the terms again at the next sign-in. The privacy page text stays as it is (the registry feeds its tables, so the page already shows the new category row). One line; no other file changes. Recompute the digest if any legal text changes before the land (the test prints it).
2. **Keep the guard green without a bump** by leaving the category out of the registry now. Not possible without a false statement: `NO_PERSONAL_DATA_TABLES` would claim that `sender_suggestions` holds no personal data, but an open suggestion holds an address in `pattern`.
3. **Overwrite the digest of the last entry in place.** Rejected: members who accepted `2026-11-17` would not see the change, and the guard exists to prevent exactly this.

## What the worker did

Nothing for `TERMS_VERSION` (instruction). The category, the records row (`docs/legal/records-of-processing.md`) and the claims row C176 (`docs/legal/claims.md`) are in. The coordinator picks option 1 or 2 before the land. If Q2 stays "no bump until the next legal batch", land stage 02 together with that batch, or accept one red unit test on `master` until then (not allowed by `CLAUDE.md`: CI on `master` must stay green).
