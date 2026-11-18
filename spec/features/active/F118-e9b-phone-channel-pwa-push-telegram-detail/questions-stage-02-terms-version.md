# F118 stage 02 · Question: the registry change needs a TERMS_HISTORY entry

## Observed

Stage 02 adds the data category `push-devices` (table `push_subscriptions`) to `packages/core/src/legal/data-categories.ts`. The schema test `apps/server/test/integration/data-categories.test.ts` requires it: every table must be in a category or in `NO_PERSONAL_DATA_TABLES`. A push device is personal data (an encrypted push endpoint, a device name), so the table cannot go into `NO_PERSONAL_DATA_TABLES`.

The unit test `apps/web/src/lib/legal-version.test.ts` test 2 hashes the registry (`JSON.stringify(dataCategories)`). The digest moves, so the test fails until `TERMS_HISTORY` gets a new entry. The job instruction says: do NOT bump `TERMS_VERSION` in this stage. The worker did not.

Digests that the worker measured (test output `digest of the current texts`):

| Tree                                                                                                 | Digest                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| master + F118 stage 02 (F120 stage 02 not merged)                                                    | `1dc172daee6d3ad546b89011f729410896e2b6f8aaa0a7c7f3a9ceaafd4f2e70` |
| master with F120 stage 02 + F118 stage 02 (this branch after the merge of master, commit `d3011ff2`) | `8386c47db63b162fb771458b7e3c31ce09d07587ca588fc51ec730c95bd420d4` |

F120 stage 02 is on master, so the second row applies.

## The exact line (after F120 stage 02 is on master)

In `packages/core/src/web/terms.ts`, add as the last entry of `TERMS_HISTORY`, after the F120 line `{ version: "2026-11-18", ... }`:

```ts
  { version: "2026-11-18-2", sha256: "8386c47db63b162fb771458b7e3c31ce09d07587ca588fc51ec730c95bd420d4" }, // data category push-devices (F118)
```

The worker checked this line on this branch (an uncommitted local edit): with it, `legal-version.test.ts`, `terms.test.ts` and `web-terms.test.ts` pass (log `.f118s02-logs/f120-merge-check-terms-entry.log`). The worker then removed the line again (instruction). If a legal text changes before the land, the test prints the new digest: use that value.

Every member accepts the terms again at the next sign-in after this version ships. The privacy page text stays as it is: the registry feeds its tables, so the page already shows the new category row. A second entry on the same day uses the suffix `-2` (rule in the comment of `terms.ts`).

## Plan question Q12

Plan question Q12 (push services as sub-processors) stays open for stage 13: the papers name FCM, Mozilla and Apple only there. This stage adds no sub-processor and no outside call.
