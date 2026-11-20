# Stage 12 split log

Stage base: 57d52e8e. Before runs: `EA_TEST_WORKER_DB=1 bun test --timeout=30000 --reporter=junit`, one run each, no failing case.

## apps/server/test/integration/channels-reply-review.test.ts

- Old lines: 821 (not the 823 of the stage file).
- Parts: `channels-reply-review-taps.test.ts` (the review taps and the consent check; 17 cases), `channels-reply-review-cards.test.ts` (the cards, card sync, quiet hours and repair; 8 cases), helpers `channels-reply-review-helpers.ts` (84 lines). Line counts: see the table at the end of this file.
- Proof: `split-proof PASS cases=25`.
- Setup list: `db` (a `testDb()` and its `afterAll` destroy: each part); `logSpy`, `errorSpy`, `errorLines`, `beforeEach`, `afterEach` (each part; only the cards part reads `errorLines`); `T`, `at`, `Team`, `consent`, `team`, `threeReplies`, `cards`, `keysOf` (helpers file, exported).
- Assertion lines: none.
- References repointed: `docs/capabilities/drafts-and-send.md` (case 5 is in the taps part), `docs/capabilities/reply-drafts.md` (both parts).

## apps/server/test/integration/follow-up-cards.test.ts

- Old lines: 836 (not the 831 of the stage file).
- Parts: `follow-up-cards-approval.test.ts` (the approval card, the consent gate, `loopConsentOf`; 12 cases), `follow-up-cards-results.test.ts` (result notice, failure notice, send held by a limit; 6 cases), `follow-up-cards-closed.test.ts` (closed-loop card edit, listed closed cards, 48 hour expiry, no visible owner, approval set; 8 cases), helpers `follow-up-cards-helpers.ts`.
- Proof: `split-proof PASS cases=26`.
- Setup list: `db` and its `afterAll` destroy, `logSpy`, `errorSpy`, `warnSpy`, `warnings`, `beforeEach`, `afterEach` (each part, same text); `T`, `at`, `World`, `world`, `run`, `outbox`, `users` (helpers file, exported).
- Assertion lines: none.
- References repointed: `docs/capabilities/open-loops.md` (the three parts).

## apps/server/test/integration/lab-demo-seed.test.ts

- Old lines: 1,122.
- Parts: `lab-demo-seed-export.test.ts` (the table specs against the database, `exportDemo`; 19 cases), `lab-demo-seed-import.test.ts` (`importDemo`: new org, no sync or send, owner, second import, replace guards; 6 cases), `lab-demo-seed-refusals.test.ts` (`importDemo`: send scope, failing import, source org unchanged, refusals, unchanged file; 5 cases), helpers `lab-demo-seed-helpers.ts`. The `importDemo` describe keeps its name in both import parts.
- Proof: `split-proof PASS cases=30`.
- Setup list: `db`, `MARK`, `NOW`, `SEND_OFF`, `orgIds`, `dayAt`, `PLAN`, `RUN`, `Fixture`, `SECRET`, `buildFixture`, `FIXTURE_COUNTS`, `exportOf`, `countsOf`, `orgColumn`, `rowCounts`, `idsOf`, `elsewhere`, `owner`, `snapshot`, `importRefusal` (helpers file, exported). The `afterEach` body became `removeDemoOrgs` in the helpers file; each part registers `afterEach(removeDemoOrgs)` and an `afterAll` that destroys `db`.
- Assertion lines: none.
- References repointed: `docs/capabilities/live-lab.md` (two places), the comment in `apps/server/src/modules/lab/demo-seed/demo-seed.test.ts`, the comment in `apps/server/src/modules/lab/demo-seed/tables.ts`.
