# F125 stage 12 — G02: delete five cases whose check a kept case already makes

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts`. May run next to 09–11, 13–20. Gets a review job (plan § Review).

Group G02 (`DELETE-DUP`, owner `ok`). Rows with evidence: `audit/review-int-e2e.md` (the four CLI rows) and `audit/review-core-web-tools.md` (the web row). Follow plan § Cut stage steps (S1–S7).

## Rows of this stage

| Deleted key (data base) | Kept key (named in the row) |
| --- | --- |
| `apps/web/integrations/changelog-releases.test.ts:46` | `apps/web/integrations/changelog-releases.test.ts:68` |
| `apps/server/test/integration/rules-cli.test.ts:71` | `packages/core/src/triage/rules.test.ts:157` |
| `apps/server/test/integration/testmail-cli.test.ts:262` | `apps/server/src/modules/testmail/lock.test.ts:20` |
| `apps/server/test/integration/org-export-cli.test.ts:123` | `apps/server/src/scripts/org-export-args.test.ts:18` |
| `apps/server/test/integration/mailbox-settings-urgency-cli.test.ts:131` | `apps/server/src/scripts/mailbox-settings-args.test.ts:138` |

The kept keys are lines at 1685baff, found from the short names in the review rows; they are no old keys, and their lines and names drift (`org-export-args.test.ts:18` has a new name since the CLI-standard change). At the stage base, read each kept file, find the case that the review row describes, and resolve it with `cut-keys --keys '<file>::<name>'` (stage 08). Write the name in the log.

## Step 1 — Check each pair, then delete

- **D18** Before a delete, the worker reads the pair at the stage base and confirms two facts: the kept case exercises the same input class (the same bad argument or the same file), and its asserts are at least as strict (exact value or exact message). A pair that fails either fact is deferred with the difference named; never strengthen the kept case in this stage (that is a rewrite, another group). Reason: the review rows are a day or more old and the kept unit cases may have changed. Rejected: delete on the row evidence alone.
- A kept key that resolves to `deferred-none` or `deferred-two` defers its row (Cut stage rule 2).
- Expect deferrals. At 96ebacd8 (plan review 3, note 1) the kept `org-export-args.test.ts` case asserts a bare `toThrow()`, while the CLI case checks exit 2 and the usage line, so that pair fails "at least as strict" and defers. A deferred pair is a correct result of this stage, not a failed stage.
- Delete the case and any helper or fixture that only it used.

## Proof (S5)

- Before: the five files of the deleted cases and the five files of the kept cases. After: the same ten files.
- `--expect unit=-1,int=-4` (less per deferred row).
- The lcov check matters most here: a source line that only a deleted case hit fails the stage. The four CLI cases spawn a process, whose lines Bun does not count; the log says so in one line.
- Break once per kept case: make the refusal it checks accept the input, see the kept case fail, restore. Five lines in the log.

## Out of scope

- Other spawning CLI cases that look like duplicates but are no row.

## Done when

- `audit/cut-s12.md` holds the pairs, each with "same input class: yes/no" and "at least as strict: yes/no", the deferred rows, the `cut-proof` PASS section and the five break-once lines.
- One commit, message `F125 G02 DELETE-DUP: five cases a kept case covers`.
- Last step: `bun run check:job`; copy its last line.
