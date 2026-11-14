FAIL 4acbd7e4ea18fc88d460c5ffb3726a8ef280e64f

This review found eight blocking findings: two text guards let a wrong legal page ship, two tests or checks cannot pass at HEAD, the cost number mixes two data sets, and two rules or interfaces are missing. HEAD matches the candidate (`git rev-parse HEAD`).

**Checks run:** I read the plan files and the code at HEAD. I ran no test suite, because this is a plan review. No install was needed, because no JavaScript check ran.

## Blocking findings

**1. The text guard does not force a `TERMS_VERSION` change.**
- `plan.md:28` (D5) and `stages/stage-02-page-frame.md:46` (test 7) compare the computed digest only with `LEGAL_TEXTS_SHA256`.
- A worker can change a text, update only the hash, and the test passes with the old `TERMS_VERSION`. Members then get no dialog.
- Test 10 (`stage-02:49`) checks only the version format.
- Fix: keep an append-only list of `(version, digest)` pairs. The test checks three things: the last digest equals the computed one, every version is unique, and every digest is unique.
- Status: proven by reading D5 and test 7.

**2. The data-category model cannot show the real retention, and stage 01 sets values that are false.**
- D4 (`plan.md:27`) gives one `kept` value per category, and `stage-01:38` says "A table holds one category". Retention works per column (`docs/capabilities/retention.md` rule 2):
  - `emails` mixes three periods: the body follows `data_retention_days`; subject and addresses go after 90 days; the ids stay.
  - `email_headers` follows the organization setting, not 90 days. But `stage-01:41` sets `mail-headers` to 90 days.
  - `chat_links` has no retention rule at all. But `stage-01:41` sets `chat` to 90 days.
  - `actions.provider_result` is never cleared, and an open draft keeps its payload. But `ai-results` is set to 90 days.
- The privacy page (D2) and the records of processing (`stage-05:11`) state these periods, so false claims reach the page.
- `stage-03:37` forbids registry changes, and stage 06 outcome 2 (`stage-06:15`) names only the Telegram row. So no later stage can fix this.
- Fix: decide `kept` per table or per column, and correct the fixed values.
- Status: proven against `retention.md` and `address-map.ts`.

**3. Stage 01 tests 4–5 cannot pass as written.**
- `stage-01:46` reads `information_schema.tables`. The integration tests connect as `app` (`helpers.ts:6-8`), and `app` does not see `schema_migrations` there (`privacy-export-map.test.ts:27-28`).
- `stage-01:47` creates `f107_probe` in the test transaction. But `app` has no CREATE on `public` (`db/roles.sql:5-7`), and `db-role.test.ts:47` asserts "permission denied for schema public".
- Fix: read the catalog from `pg_class`, and create the probe on `MIGRATOR_DATABASE_URL`, with the catalog read in the same transaction.
- Status: proven by `db-role.test.ts:47` and `roles.sql`.

**4. Stage 07 check 4 cannot pass, and a failed check 4 starts a rollback.**
- `stage-07:28` runs `grep sync_done`. No `sync_done` event exists at HEAD: the sync line is the old text form `synced <id>: …` (`mail/jobs.ts:47`).
- `sync_done` was only an example name in the F089 plan (`F089 plan.md:34`).
- `stage-07:42` rolls back when checks 1–4 fail, so a good deploy gets rolled back.
- F106 `stage-12-vps.md:32` has the same line. Report this to the coordinator; it is outside this ticket.
- Status: proven by grep.

**5. Deploys of other tickets between stages 02 and 06 have no rule.**
- Stages 02, 03, 04 and 06 each land a version bump on `master`. Stage 02 ships pages that say "Text follows in a later step." (`stage-02:9`).
- The ticket allows parallel builds (`ticket.md:36`), and other VPS deploys are on the board (F094 stage 2, F096).
- Any such deploy shows members placeholder legal pages and repeated dialogs. This breaks acceptance bullet 2 (`ticket.md:28`).
- Fix: decide "no VPS deploy of `master` from the land of stage 02 until stage 07", or keep the version and placeholder pages off the deployed build until stage 06.
- Status: the missing rule is proven; the deploy event is plausible.

**6. `ActiveWhen.llmProvider` ignores the per-role provider keys.**
- D3 (`plan.md:26`), E2 (`plan.md:41`) and `stage-01:15-16,27` link a provider only to `LLM_PROVIDER`.
- The config has `LLM_<ROLE>_PROVIDER` for judge, drafter, extractor and escalation (`config.ts:21-40, 367-371`; `.env.example:23-40`). With one of them set to `gemini`, mail goes to Gemini while the page says "used when LLM_PROVIDER=openai".
- E10b and F111 reuse this interface.
- Fix: base the condition on the role table (any role's effective provider), and add a test over `llmRoles`.
- Status: proven in the code; a false claim is plausible, depending on the VPS env.

**7. No test catches a new outside service, although the ticket outcome says one does.**
- `ticket.md:9` says a test fails when a later ticket adds "a table or an outside service".
- The plan covers tables (D4) and the existing LLM keys (`stage-01:27`). Test 2 (`stage-01:28`) checks only the env keys of existing rows.
- A new service from F118, F117 or F112 fails nothing.
- Fix: every config key that matches `*_URL`, `*_HOST`, `*_API_KEY` or `*_TOKEN` maps to a registry row or to a reasoned exempt list.
- Status: proven by reading.

**8. The pilot cost per mail divides two different data sets.**
- `stage-08:11` sets `llmUsd / mails`:
  - `llmUsd` comes from four `stats:week` runs (`stage-07:34`): finished Monday weeks, org-wide, because `--mailbox-id` is not passed.
  - `mails` comes from `triage:cost --days 28` (`stage-07:35`): one mailbox, the 28 days before now (`triage-cost.ts:118`).
- `unpricedCalls` drop out of `llmUsd` (`m7.ts:39`), but no rule says what happens then.
- Fix: one window and one scope for both numbers. Decide that `unpricedCalls > 0` sets basis `estimate`, or that the doc names it.
- Status: proven by reading the scripts.

## Notes

**9. `hibp` cannot be expressed as a condition.** `AUTH_PWNED_CHECK` defaults to `on` (`config.ts:197`), but the `env` kind means "used when set". (proven)

**10. Placeholder escaping is only half decided.** `<to confirm: x>` also parses as an HTML tag and would disappear from the page. `stage-02:16` does not say where escaping happens, and test 3 (`stage-02:22`) checks only `<provider name>`. Add a check on the built HTML. (plausible)

**11. The guard input misses some texts.** It covers only the `legal_*` keys (`plan.md:28`). The table and "used when" keys have no fixed prefix, and `tg_consent_text` is not hashed. (proven by reading)

**12. Stage 02 conflicts with itself.** The bodies are one placeholder line (`stage-02:9`), but test 3 expects `<provider name>` in the en privacy body (`stage-02:22`). (proven)

**13. The ticket can close with acceptance bullet 2 unproven.** Plan Done when 6 (`plan.md:66`) needs the owner's acceptance. Stage 07 Done when (`stage-07:51`) excludes U1, and stage 08 closes the ticket (`stage-08:49`). (proven)

**14. The digest function sits in a browser module.** `legalTextsDigest` is to go in `lib/legal.ts` (`stage-02:40`), which the browser islands `TermsDialog.tsx:6` and `SetupPage.tsx:11` import. Put it in a test-only module. (plausible)

**15. `costToRun` has no fixed import path for F121.** D10 (`plan.md:33`) fixes none, and the web app imports only `@ea/core/web` (`packages/core/src/web/index.ts:1`). (proven by reading)

**16. The pilot data source will move.** `pilot-cost.md` (`stage-07:36`) moves to `done/` at close, so a path to it breaks. The capability test skips `spec/` for this reason (`capability-map.test.ts:9`). (plausible)

**17. Three table lists have no cross-check.** No test checks `NO_PERSONAL_DATA_TABLES` against `EXPORT_MAP` and `DSR_ADDRESS_MAP` (`privacy-export-map.test.ts:43-46`). (proven by reading)

**18. Stage 07 diverges from the documented update.** It skips `db:migrate` and the log-rotation check of `deploy/README.md` § Update. `stage-07:10` says "no migration", but the merge can bring migrations of tickets that have no VPS step. Follow § Update in full. (plausible)

**19. Command output in stage 07 holds ids.** `stats:week` prints mailbox ids (`stats-week-args.ts:70`), and `triage:cost` prints the mailbox id (`triage-cost.ts:124`). Say that the output is never pasted as is. (proven)

**20. Stage 02 is the largest stage.** It holds three steps and 10 tests (5 of them e2e). It is a candidate to split, not a failure. (note)

## Note check
- HEAD is 4acbd7e4ea18fc88d460c5ffb3726a8ef280e64f: proven. `git rev-parse HEAD` printed `4acbd7e4ea18fc88d460c5ffb3726a8ef280e64f` (a single-command call).
- Each finding quotes file and line and is checked against the code at HEAD: proven. I read each cited file in this job, for example `apps/server/test/integration/db-role.test.ts`, `docs/capabilities/retention.md`, `apps/server/src/platform/config.ts`, `apps/server/src/modules/mail/jobs.ts` and `apps/server/src/scripts/triage-cost.ts`. No single exit-0 command covers all of them.
- The final message opens with `PASS|FAIL <sha>` and ends with VERDICT and a numbered list: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f107-plan-review-95abeb45/review-final.md` holds the first line and the VERDICT list.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each item in `review-final.md` names a missing decision, test, rule, interface or false fact. None of them asks for line numbers or edit text.

VERDICT: FAIL
1. blocking — D5 guard does not force a `TERMS_VERSION` change.
2. blocking — data-category `kept` model and fixed values contradict the retention code.
3. blocking — stage 01 tests 4–5 cannot pass as the `app` role.
4. blocking — stage 07 check 4 `sync_done` does not exist and triggers a rollback.
5. blocking — no rule for deploys of other tickets between stages 02 and 06.
6. blocking — `ActiveWhen.llmProvider` ignores `LLM_<ROLE>_PROVIDER`.
7. blocking — no test catches a new outside service (ticket outcome).
8. blocking — pilot cost per mail mixes windows and scopes; no rule for unpriced calls.
9. note — `hibp` "on unless off" has no condition kind.
10. note — placeholder escaping place undecided; `<to confirm: …>` not tested.
11. note — guard misses keys without the `legal_` prefix and `tg_consent_text`.
12. note — stage 02 stub body conflicts with test 3.
13. note — U1 not required, but plan Done when 6 needs it.
14. note — digest function in a browser-imported module.
15. note — no import path fixed for `costToRun` for F121.
16. note — `pilot-cost.md` path breaks when the ticket moves.
17. note — no cross-check of `NO_PERSONAL_DATA_TABLES` with `EXPORT_MAP` and `DSR_ADDRESS_MAP`.
18. note — stage 07 skips `db:migrate` and parts of README § Update.
19. note — stage 07 command output holds mailbox ids.
20. note — stage 02 size.
