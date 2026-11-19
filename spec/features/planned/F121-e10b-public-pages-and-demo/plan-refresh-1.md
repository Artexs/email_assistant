# F121 plan refresh 1

Old base: `c68ce51e`. New base: `f21809c4` (HEAD, 2026-11-19). Job `2026-11-19-f121-plan-refresh-fac3e351`. No scouts.

## Drift output (`scripts/plan-drift.sh <folder> c68ce51e`)

```
plan base: c68ce51e 2026-11-19 00:41
HEAD:      f21809c4 2026-11-19 22:42
named paths: 56; changed since base: 7; gone: 0
changed: apps/docs/src/flagged-text.ts
changed: apps/server/src/openapi-routes.test.ts
changed: apps/server/src/platform/openapi.ts
changed: apps/web/src/lib/legal-tables.ts
changed: deploy/README.md
changed: packages/core/src/legal/subprocessors.ts
changed: packages/core/src/metrics/cost-model.ts
commits after the base that touch the named paths:
  c3a92d3a 11-19 21:13 F107 stage 08: cost-model comment without a bare ticket code
  b48ccb7a 11-19 21:09 F107 stage 08: costToRun, pilotCost and the shared hosting share
  e0e5a098 11-19 21:05 F115 stage 17: gate state after the OpenAI runs (G1 not passed) in the docs, response note
  77fa2d84 11-19 20:46 F115 stage 17: rollback SQL fails urgent views with draftable, block outside the list and copyable, in-flight rows named (N3, N4, N5)
  d683b631 11-19 20:46 F115 stage 17: consent text names the Reply-To addresses that the review card shows, Polish style fixes, one consent version (N1, N6)
  d276d063 11-19 20:45 F115 stage 17: the Confirm block shows for reply_drafts too, neutral title, docs agree with the code (B2)
  23d10e09 11-19 20:08 F115 stage 17: deploy guide for reply drafts with tested rollback SQL, ADR 0033 accepted, architecture and module docs, capability page updates
  602e7261 11-19 20:03 F115 stage 17: capability page for reply drafts, legal text batch (reply consent version 2026-11-19, privacy text, row openai), capability map fixes
  4495e7e0 11-19 19:33 F114 stage 09 Part C: restore drill record (restore 173 s, counts equal, live untouched)
  36c1a440 11-19 19:31 backup.sh: retry the B2 copy with backoff and lock against concurrent runs
  62d0727d 11-19 16:09 docs(privacy): rule check, rule_mismatch refusal and --rule-check (F137 stage 04)
  59b59b09 11-19 11:44 F118 stage 13 review N1-N9 and Polish fixes: untilDelete scopes, push texts, terms, faq, claims, TERMS_HISTORY digest
  916e17db 11-19 11:42 F120 stage 12: sender-context capability page, ADR 0034 accepted, deploy rollback, legal drafts, docs guard and rollback SQL tests
  0b3f8c9b 11-19 11:41 F118 stage 13 review B1, N8: rollback to a build older than the push sender closes push rows first
  2663c767 11-19 10:59 F118 stage 13: papers (web-push row, Telegram levels, TERMS_VERSION 2026-11-19), docs, ADR 0032 accepted, rollback lines
  d8d2ae80 11-19 05:45 F118 stage 10: migration B (member detail level, org lock, wider outbox detail list), flag telegram_minimal, effectiveDetail
  4ec48e43 11-19 05:16 F120 stage 07 review: Accept re-check covers a sender that the 90-day activity no longer shows
  651bcc11 11-19 02:53 F118 stage 08: push renderer, facts and the push sender job
  b5fbe748 11-19 00:52 Phone channel: route rule and routes setting; no audit row for a panel load that changes no binding
  1f915043 11-19 00:49 F111 stage 06: own-model guide, ADR 0035 accepted for decisions 1-5, guard test
  b84e8c34 11-19 00:25 Reply routes for the panel: request, redraft, recipients, status; read model fields; own +tag, display-name and Reply-To rules
```

## Changes (stage, what, why)

- All stages: a `Needs` line first, naming the files, interfaces and data each stage reads (owner rule 2026-11-20, `notes/2026-11-20-replan-parallel.md` § 8.3). Playwright stages 07, 10, 11, 12 carry "lock rule until F136 lands".
- plan.md: status line with the new base; Facts checked rewritten for `f21809c4`; D1 notes the owner's acceptance of the hold (replan decision 12); D5 widened to the recording; new D10 (stages 09–10 build on the e2e seed; owner answer 2026-11-20 § 10 "Calendar waits"); C1 starts only after the F113 day run `day-20261120-215c` ends and gates no stage; How to run rebuilt from the Needs lines; "Done when" removed (ticket acceptance holds it; word cap).
- P2, P3: no F121 page names Gemini (F138 removes the provider); pricing shows no model names (`pilotCost.models` holds a Gemini model id).
- Stage 02: Needs F138 stage 02 (registry without `gemini`); no claim cites the Gemini ledger rows (C038, C139–C141); test 8 (no `gemini` in the built page); sub-processor rows show their "used when" condition, and flag-gated registry text (`web-push`, reply-draft data) shows as the registry says (Q11, default).
- Stage 03: no longer waits for F107 stage 08 (landed, `b48ccb7a`); `costRows(compute = costToRun)`; rounding half up as `cost-model-doc.test.ts`; tests 2–4 now have fixed values (estimate block: 0.62/0.83/1.26, margins 24.38/24.17/23.74; measured fixture: 1.91 / 23.09) and test 4 ties the rows to `docs/cost-model.md`; no `/security/` link (moved to stage 04 so 03 does not wait for 02 and F138).
- Stage 04: step 3 adds the pricing → security link.
- Stage 05: pl pages hold no `gemini`.
- Stage 06: the API page shows every answer status (`apiDoc` `alsoOk` since `b84e8c34`, used by the reply routes); test 8 no `gemini`.
- Stage 07: Needs nothing new (was "stage 01"; no shared interface, only `astro.config.mjs`); `shotSource()` is also the stage 10 source.
- Stage 09: Needs stage 08 only (C1 removed); the spike runs on the e2e seed (D10).
- Stage 10: `--seed` optional (`shotSource()` decides); setup for the e2e source; proof runs on the e2e source; new test 4 (demo-source setup with a synthetic seed and the address guard).
- Stage 11: Needs names 01 (workflow input, gate), 04 (home pages), 10 (`demo:record` name).
- Stage 12: test 4 (no F121 page names Gemini); the close-out note names the follow-up ticket.
- interfaces.md: `costRows(compute)`, `costToRun` signature, `subprocessors` from `@ea/core/web`, `shotSource()` in `source.ts` used by stage 10, `demo:record [--seed]`.
- questions.md: G3 (only a C1-seed video is a candidate), Q10 counts, new Q11 [important: privacy], Q12 [minor], C1 start condition.

## Facts checked that needed no change

- `.github/workflows/docs-deploy.yml`: no commit since the base; `workflow_dispatch: {}`; the gate reads `GATE_*` env; build job runs `docs:stale --strict`, `docs:shots`, `docs:build`, `docs:test`. Stage 01 and 11 steps still fit.
- `apps/docs/scripts/deploy-gate.ts`: skip reasons `is not a tag`, `is not a release tag`, `is not the newest release`, error `changelog_missing` as stage 01 and 11 tests assume.
- `apps/docs/src/flagged-text.ts`: new entries for `sender_context`, `sender_suggestions`, `contact_wait`, `telegram_minimal`; stages only extend the lists; no rule change.
- `apps/web/src/lib/legal-tables.ts`: `keptText` change only; `usedWhenText` unchanged.
- `apps/server/src/openapi-routes.test.ts`: new tests only; `realApp()` with fakes still the base for `buildPublicSpec()`.
- `deploy/README.md`: F118 and F115 sections; stage 11 adds a docs owner step, no conflict.
- `publicContentScan` allows `example.com` and `.test` addresses (e2e seed passes the stage 10 scan).
- No landed ticket did a step of this plan (no `publish-gate.ts`, `claims.ts`, `pricing.ts`, `api-spec.ts`, `view.ts`, `apps/web/e2e/demo/` at HEAD).
- All Build after tickets (F100, F107, F110, F113, F114) are in `done/`.
