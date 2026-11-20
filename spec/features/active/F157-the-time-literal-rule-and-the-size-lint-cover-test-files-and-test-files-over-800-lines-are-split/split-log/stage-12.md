# Stage 12 split log

Stage base: 57d52e8e. Before runs: `EA_TEST_WORKER_DB=1 bun test --timeout=30000 --reporter=junit`, one run each, no failing case.

## apps/server/test/integration/channels-reply-review.test.ts

- Old lines: 821 (not the 823 of the stage file).
- Parts: `channels-reply-review-taps.test.ts` (the review taps and the consent check; 17 cases), `channels-reply-review-cards.test.ts` (the cards, card sync, quiet hours and repair; 8 cases), helpers `channels-reply-review-helpers.ts` (84 lines). Line counts: see the table at the end of this file.
- Proof: `split-proof PASS cases=25`.
- Setup list: `db` (a `testDb()` and its `afterAll` destroy: each part); `logSpy`, `errorSpy`, `errorLines`, `beforeEach`, `afterEach` (each part; only the cards part reads `errorLines`); `T`, `at`, `Team`, `consent`, `team`, `threeReplies`, `cards`, `keysOf` (helpers file, exported).
- Assertion lines: none.
- References repointed: `docs/capabilities/drafts-and-send.md` (case 5 is in the taps part), `docs/capabilities/reply-drafts.md` (both parts).
