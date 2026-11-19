# F107 plan review 1 — response

Review: [plan-review-1.md](plan-review-1.md) (job `2026-11-14-f107-plan-review-95abeb45`, `claude-opus-5-5`, candidate `4acbd7e4`): FAIL, 8 blocking, 12 notes. All 20 are accepted and fixed; none is rejected.

| # | Kind | Fix |
| --- | --- | --- |
| 1 | blocking | D5 is now an append-only `TERMS_HISTORY` of `(version, sha256)`; the test checks the last digest, unique versions, unique digests (stage 06 step 2). A text change cannot pass with an old version. |
| 2 | blocking | D4 is per column (`columns: "table.column" \| "table.*"`, one period per category, a table may span categories); new `Kept` kind `daysAfterClose`; stage 01 takes periods from the retention code and pins the cases the review named (`email_headers` org setting, `chat_links` and `actions.provider_result` until delete, `delegations.task_summary` after close, test 8). Stage 06 may fix any registry row (outcome 2); stage 03 reports a wrong row instead of a stop. |
| 3 | blocking | Stage 01 tests 5–6 read `pg_class` and create the probe as the migrator role in one transaction. |
| 4 | blocking | Stage 07 check 5 counts `synced ` lines (the real text form at `69473f4e`). The same `sync_done` line in F106 stage 12 is an outside edit in the planner's final message. |
| 5 | blocking | One bump only, in stage 06 (D5); D14 allows other tickets' deploys between stages 02 and 06 (draft line on every page, no second acceptance); Q10 for the owner. |
| 6 | blocking | `ActiveWhen.llmProvider` = any LLM role uses the provider (`LLM_PROVIDER` or `LLM_<ROLE>_PROVIDER`), D3. |
| 7 | blocking | `OUTSIDE_SERVICE_KEYS` map; stage 01 test 3 fails on a config key ending in `_URL`, `_HOST`, `_API_KEY`, `_TOKEN`, `_ENDPOINT` without a row or an exempt reason. |
| 8 | blocking | One window and one scope: four `stats:week` weeks of the organization (LLM cost and triaged mails); `triage:cost` is informational. `estimate` basis above 5% unpriced calls; the doc always names them (stage 08 tests 1–3). |
| 9 | note | `ActiveWhen` env kind has `unless` (`hibp`: unless `off`). |
| 10 | note | D6: placeholders are escaped with a backslash in the source; raw HTML fails the check; e2e test 3 checks every found placeholder on the built page. |
| 11 | note | The digest covers every `legal_*` key and `tg_consent_text`; every new frame key starts with `legal_` (stage 02). |
| 12 | note | Stub bodies are fixed in stage 02 and hold the placeholders that test 3 reads. |
| 13 | note | Done when 6 and stage 07 check 3: an SQL count proves the dialog will show; U1 stays an owner step and does not hold the close. |
| 14 | note | Digest and file checks live in the test-only module `apps/web/src/lib/legal-checks.ts`. |
| 15 | note | `costToRun` is exported from the `@ea/core` root (D10). |
| 16 | note | Code and doc cite "the F107 ticket folder", not a path (stage 08). |
| 17 | note | Stage 01 test 5: a table is never in a category and in `NO_PERSONAL_DATA_TABLES`; test 7 puts every `DSR_ADDRESS_MAP` table in a category with `others`. |
| 18 | note | Stage 07 runs `deploy/README.md` § Update in full, with `db:migrate` when the merge brings one. |
| 19 | note | Stage 07 rule: never paste command output; copy only the named numbers. |
| 20 | note | The version guard moved from stage 02 to stage 06; stage 02 keeps 7 tests. |

Word counts after the fixes (`wc -w`): plan 1478; stages 01–08: 699, 623, 647, 694, 571, 699, 689, 697.
