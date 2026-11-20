# Split log, stage 11 — channels callbacks, card sync, sender

Stage base: `57d52e8e`. Before runs: `EA_TEST_WORKER_DB=1 bun test --timeout=30000`, no failure. Each part ran in its own `bun test` call. All parts and helpers files are at most 600 lines (largest: 358). No `assertions` line differs (split-proof printed none).

## `apps/server/test/integration/channels-callbacks.test.ts` (1,496 lines)

Parts (lines): `channels-callbacks-feedback.test.ts` 323 (handleCallback incl. undo), `-approve` 334, `-reject` 229, `-send-again` 296, `-reasons` 178, `-suspended` 106; helpers `channels-callbacks-helpers.ts` 122.

Proof: `split-proof PASS cases=56`.

Setup list of the old file and where it went:

- `const db`, `afterAll` destroy: each part.
- `T`, `NOT_FOUND`, `feedbackRows`, `setup`: helpers file (exported).
- `ageFeedback`: the feedback part (its only user).
- `ORIGINAL`, `approvalSetup`, `queueFor`, `sendRow` (were inside `describe("approval taps")`): helpers file, exported at top level.
- `describe("approval taps")` is split over four parts (approve, reject, send-again, reasons) and keeps its name in each; `describe("handleCallback")` and `describe("taps of a suspended organization")` keep one part each. `handlersFor` and `PAUSED` stay in the suspended part.
- No hook, `mock.module` or `setSystemTime` in the old file.

References repointed: `docs/capabilities/digest-and-notices.md` (list of channel tests: all six parts).

## `apps/server/test/integration/channels-card-sync.test.ts` (1,042 lines)

Parts: `channels-card-sync-decisions.test.ts` 291, `-hooks` 278, `-probes` 343; helpers `channels-card-sync-helpers.ts` 216.

Proof: `split-proof PASS cases=26`.

Setup list:

- `const db`, `afterAll` destroy, the file comment: each part.
- Constants `LINKED`, `CARD_AT`, `NOW`, `edits`, `CLOCK`; `World`, `insertCard`, `world`, `depsOf`, `tapDeps`, `linkOf`, `senderOf`, `editRows`, `sendState`, `setSend`, `byMessage`: helpers file (exported). `SWITCHES` stays private to the helpers file.
- The `beforeEach`/`afterEach` log capture with `logLines`, `errorLines` and the three spies: helpers function `captureLogs()`, called at the top level of every part; the four reads of `[...logLines, ...errorLines]` became `allLines()` (same value).

References repointed: `digest-and-notices.md` (three parts), `drafts-and-send.md` (three parts), `FIXTURE_LABELS` in `apps/server/src/bare-codes.test.ts` (one entry per file with a `U1`/`C1` comment: decisions, hooks, probes, helpers).

## `apps/server/test/integration/channels-sender.test.ts` (1,006 lines)

Parts: `channels-sender-delivery.test.ts` 358, `-no-text` 134, `-logs` 166, `-quiet-hours` 270; helpers `channels-sender-helpers.ts` 159.

Proof: `split-proof PASS cases=44`.

Setup list:

- `const db`, `afterAll` destroy: each part.
- `T`, `SECRET`, `at`, `SECOND`, `Tenant`, `tenant`, `addRow` (with its private counter), `rowState`, `storedMessage`, `senderFor`, `allLines`, `expectEvent` (with private `eventsOf`, `BASE_KEYS`, `UUID_LOWER`, `LoggedEvent`): helpers file.
- The `beforeEach`/`afterEach` log capture: helpers function `captureLogs()`, called in every part.
- `CANARY`: the logs part (its only user).

References repointed: `digest-and-notices.md` (list of channel tests: four parts; the report-mail line names the quiet-hours part), `trust.md` (quiet hours: the quiet-hours part).
