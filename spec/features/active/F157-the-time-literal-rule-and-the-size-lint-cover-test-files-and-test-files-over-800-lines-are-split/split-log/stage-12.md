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
