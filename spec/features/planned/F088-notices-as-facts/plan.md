# F088 · Notices as facts: plan

> **Status 2026-11-13 — planned.** Six stages written; cold review in § "Cold review". Builds after F086. Stage 02 is a migration: it never runs next to another migration stage (F087 stage 1, F092 stage 1). Ticket: [ticket.md](ticket.md). Open defaults: [questions.md](questions.md).

## Input

Source: the architecture review (`docs/product/stage-2/06-architecture-review.md` §3.4, §3.10, part of §3.3), ADR 0032 point 5 ("A notice is stored as facts (kind, ids, counts) and rendered for its channel and detail level when it is sent. The send-time renderer reads the user's current choice."), PD-033 (mail channel for digest and report), PD-037 ("panel, auth mails and Telegram texts follow `users.locale`"), PD-094 ("Notices are stored as facts and rendered per channel and detail level at send time."), and the foundation plan (`docs/product/stage-2/07-foundation-plan.md` §1 row 4, §2: "lane B `F088 → F091`"; "Migrations (F087 stage 1, F088 stage 1, F092 stage 1) never run at the same time"). The review §3.4 also says: "Approval cards keep the 'render from the stored bytes' rule." The owner answered the product questions before this planning job; the job does not reopen them.

### Design decisions of the ticket author (2026-11-13, kept word for word)

- **D1 The view is the fact.** `outbox.view jsonb` holds the renderer input the detector builds today (ids, counts, short strings such as the subject that the renderer prints). The detector stops rendering. The sender renders. The digest keeps its rendered text in `view.text` for now (its view is large and lives in `reports`); E4-B gives it a mail renderer.
- **D2 Columns.** Add `view jsonb NOT NULL DEFAULT '{}'`, `channel text NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram'))` (E4-B adds `mail`, E9b `push`), `locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('pl','en'))`, `detail text NOT NULL DEFAULT 'full' CHECK (detail IN ('full'))` (E9b adds `minimal`). `text` becomes nullable: null until sent; the CHECK on length applies when not null. Old rows keep their text and an empty view; the sender sends a row with text and an empty view as it is (compatibility until the old rows age out, 90 days).
- **D3 Renderer registry in core.** `packages/core/src/notices/index.ts`: `renderers: Record<NoticeKind, (view: unknown, opts: { channel, detail, locale }) => OutMessage>`; each renderer parses its view with a Zod schema (`viewSchemas[kind]`), so a bad view fails before a send. The existing render functions move under this registry unchanged; `en` texts stay where they are and `pl` keys come with E7-T1.
- **D4 Detector registry.** `channels/notices/<kind>.ts` exports `{ kind, detect(db, ctx, members, now) }`; `channels/notices/index.ts` lists them; `detectForOrg` iterates. The urgent, approval and send-result detectors keep their queries; only the `queue` call changes shape.
- **D5 Completeness test.** `outboxKinds` (core) = keys of `renderers` = keys of the detector list (the digest and `mailbox_removed` have "queue" functions instead of detectors; the test accepts a `queuedBy` marker). The DB CHECK list is compared in an integration test (`pg_constraint`).
- **D6 Locale per row.** The detector reads the member's `users.locale` once per organization run and stores it. A locale change after the queue does not re-render a pending row; that is acceptable (rows live minutes).
- **D7 Edits.** The approval card edit renders `renderers.approval(view, …)` plus the status line from the same registry (`renderers.approval_status`), so the edit never drifts from the card.
- **D8 Retention.** `clearOutboxTexts` clears `view` and `text`; `docs/architecture.md` §7 row "Message text" names both.
- Open questions of the author, answered with their defaults: the digest view carries the rendered text (D1); `detail` is a column now with one value (D2).

### Decisions of this planning job (2026-11-13)

Each one refines D1–D8 after a fact check. "Default" marks a choice that the owner may still change; it is listed in [questions.md](questions.md). None changes the stage list.

- **D9 Six stages, not five (default).** The author's stage 3 ("sender renders", with every producer and every outbox test) is about 450 changed lines. It splits in two: stage 03 makes every producer queue a view and still stores the text rendered from that view; stage 04 stops storing the text at queue time and makes the sender render. Between the two, every existing integration assertion on `outbox.text` runs against the output of the registry: that is the byte-identical proof of the acceptance. The registry (author stage 2) comes first as stage 01, because stages 03 and 04 need it and it touches no DB. Rejected: one flip stage (too big for one job; the byte-identical proof and the sender change would land in one review).
- **D10 Registry shape.** `packages/core/src/notices/` holds `kinds.ts` (`noticeKinds`, `noticeChannels = ["telegram"]`, `noticeDetails = ["full"]`, the types), `views.ts` (one strict Zod schema per kind), `renderers.ts` (`noticeRenderers`: per kind `{ schema, telegram: { full(view, opts) } }`), `encode.ts` (`encodeNoticeView`, `NoticeViewError`), `render.ts` (`renderNotice`, `renderNoticeEdit`), `index.ts`. `renderNotice(kind, view, opts)` never throws: it returns `{ ok: true, message }` or `{ ok: false }`. It fails on a view that its schema rejects, on a renderer that throws (a renderer throws on a non-uuid id inside a button, probe P4), on an empty text or a text over `MESSAGE_MAX_CHARS`, and on buttons that `outButtonsSchema` rejects. The key `telegram → full` leaves room for `mail` (E4-B) and `minimal` (E9b) as new entries. Rejected: a flat `Record<kind, fn>` (E4-B and E9b would change every function signature).
- **D11 The render functions stay in their files (default).** D3 says they "move under this registry unchanged". They stay in `packages/core/src/digest/{notices,approvals}.ts` with their unit tests, and `notices/renderers.ts` imports them. Reason: a file move gives no behaviour, conflicts with every open branch that touches these files, and E7-T1 restructures the texts per locale anyway. Rejected: moving the files and keeping old names as aliases for one stage.
- **D12 The view holds the detector's `now` and the organization's `timeZone` (default).** `formatClock(at, timeZone, now)` prints `22:15` for today and `13 Nov 22:15` for another day. Rendering with the send-time clock would change the text of a notice held by quiet hours overnight, and the acceptance asks for byte-identical texts. So every view with a clock keeps `now` and `timeZone` as facts. A later epic may switch a renderer to the send time (one line per renderer). Rejected: send-time `now` (changes texts; not asked).
- **D13 A view holds facts, not English phrases.** The ticket rule is "never builds channel text". Two inputs of today are English phrases built by the detector: the urgent `aiText` (`aiTextFor`) and `wouldDo` (`describeActions`), and the send-result fallback address `"(unknown)"`. The urgent view stores their inputs instead (`ai: { reasonCode, reason }`, `actions: WouldDoAction[]`, `delegateNames`, `stayFolder`), and the registry entry calls `aiTextFor` and `describeActions` before `renderUrgentNotice`; the send-result view has `recipient.address: string | null` and the entry maps null to `"(unknown)"`. Same bytes (unit test per kind). `describeActions` takes `readonly WouldDoAction[]` (`Pick<ActionView, "type" | "status" | "folder" | "reverse" | "kind" | "delegateId">`), so every caller still compiles. Known English strings that stay in views, for E7-T1: `ApprovalView.sender.label` holds `"(unknown sender)"` when the sender is null (built by `approvalViewOf`), and `ApprovalView.subject` / `body` are the outgoing mail (its own language). Rejected: storing `wouldDo` and `aiText` as strings (E7-T1 would have to change the urgent view again).
- **D14 Strict view schemas.** Every view schema is `z.strictObject` (nested objects too): a view holds exactly the declared facts, so a detector that passes a whole repository row (with a body or an address the renderer does not print) fails at the queue. Ids are `z.string().min(1)` (the callback encoder checks the uuid form, D10). Dates are `z.iso.datetime()` with a transform to `Date` (probe P1).
- **D15 Encode at the queue, check render at the queue.** `encodeNoticeView(kind, view)` turns the typed view into the JSON that the row stores: `JSON.stringify` (a `Date` becomes its ISO string), every string with a lone surrogate replaced by U+FFFD and U+0000 by a space (Postgres `jsonb` refuses both escapes; `cutText` makes the same replacements before a print), then the schema check. On failure it throws `NoticeViewError` whose message holds only the kind. The channels helper `queueNotice` then calls `renderNotice` on the stored JSON and throws `NoticeViewError` when it fails. Reason: today a row that cannot render (too long, bad button) never enters the outbox (the insert fails, the detector skips the event and warns once); the check keeps that rule. Rejected: queue without a check (the row would be marked notified and then fail at send, so an approval request would be lost instead of retried).
- **D16 Locale of the row (default).** `LinkedChat` gets `locale: UserLocale` from a join on `users` in `selectLinkedChats` (one query, every producer has it). A user without `users.locale` gets `pl`, the rule of the auth mails (F082 B1). Until E7-T1 adds `pl` texts, every renderer prints its `en` text for both locales and ignores `opts.locale` (one comment per file). The column default `'en'` applies only to rows from before the migration. Rejected: `null → en` (E7-T1 would have to change the producer); a separate `tenancy` query per organization (a second query for the same rows).
- **D17 The edit after a tap keeps the stored bytes (default; refines D7).** `docs/architecture.md` §4.5 says "the approval message keeps its text and gets one line", and the review §3.4 says "Approval cards keep the 'render from the stored bytes' rule". The stored `outbox.text` is the rendered cache, so it is the exact card the user saw; a new render from the view could differ after a deploy, or after E9b changes the user's detail level. So the edit is `renderNoticeEdit({ original: row.text, outcome, at, timeZone, … }, { channel, detail, locale } of the row)`: the registry's status-edit entry (today `approvalEdit`) appends the status line. The edit thus goes through the registry and has the status in its input (ticket scope line), and the card never drifts. A row with `text` null (never sent) gives no edit, as an unknown row does today. Rejected: render the card again from `view` (D7 as written; risk of a changed card under the user's thumb).
- **D18 The sender.** A claimed row with `text` not null is sent as it is (rows queued before stage 04; the sender fails every row older than 24 h with `expired`, so this path is dead one day after the deploy). A row with `text` null is rendered with `renderNotice(kind, view, { channel, detail, locale })` right after the 24 h check and before the quiet hours: a failure makes it `failed` / `bad_view` with the log line `outbox <id>: bad view (<kind>)`. `markOutboxSent` writes `text` and `buttons` of the sent message in the same `UPDATE` that sets `sent`. A crash after the send and before the mark leaves `sending` with `text` null; the stale claim renders again (same view, same code, same bytes) and sends again, which is today's at-least-once rule.
- **D19 Retention and the mailbox delete clear `view`.** `clearOutboxTexts` sets `text = '[removed]', view = '{}'` and selects rows `WHERE text IS DISTINCT FROM '[removed]' OR view <> '{}'::jsonb` (a never-sent row has `text` null, and `null <> '[removed]'` is not true). The function `delete_mailbox` is replaced (`CREATE OR REPLACE`) in the same migration: sent and failed digest rows get `text = '[removed]', view = '{}'`. Reason: the digest view holds the digest text (D1), which mixes mailboxes.
- **D20 The migration down path.** It fails the rows that have no text (`pending` / `sending` become `failed` / `outdated`; every one gets `text = '[removed]'`), sets `text` back to `NOT NULL`, restores the old `delete_mailbox` body, and drops the four columns.
- **D21 Detector registry shape.** `channels/notices/run.ts` defines `OrgRun = { deps, ctx, now, timeZone, resumedAt, members, owners, mailboxes, pausedMailboxIds }` and `Detector = { name: string; kinds: readonly NoticeKind[]; detect(run: OrgRun): Promise<void> }`. One file per detector. The sync detector keeps its one function for `sync_stale` and `sync_ok` (`kinds: ["sync_stale", "sync_ok"]`; splitting it would duplicate the grace rules). `auth_error` and `sync` loop over the mailboxes inside their own detector: the old order (per mailbox: auth error, then sync) becomes "all auth errors, then all syncs"; rows get the same `created_at` and dedup keys, so nothing a user sees changes. `queuedBy` in `channels/notices/index.ts` names the two producers outside the list: `digest → "channels/digest-job.ts"`, `mailbox_removed → "channels/notices/mailbox-removed.ts"`. A detector that throws stops its organization's run, as today.
- **D22 Completeness tests.** Unit (core, stage 01): the keys of `noticeRenderers` equal `noticeKinds`. Unit (server, stage 05): the `kinds` of all detectors plus the keys of `queuedBy` equal `noticeKinds`, each kind once. Integration (stage 02, next to the migration): the `CHECK` lists of `outbox.kind`, `outbox.channel`, `outbox.detail` and `outbox.locale` in `pg_constraint` equal `noticeKinds`, `noticeChannels`, `noticeDetails` and `userLocales`. `Record<NoticeKind, …>` types make a missing renderer a typecheck error as well.
- **D23 One kind list.** `noticeKinds` in core is the list. `channels/repo.ts` keeps the names `outboxKinds` and `OutboxKind` as aliases of `noticeKinds` and `NoticeKind` (the module index and tests use them). `outboxFailCodes` gains `bad_view`.
- **D24 Logs.** No log line, error text, test name or commit message holds a view, a rendered text, a Zod error or a field of a view. The lines that this ticket adds or changes hold ids, kinds and codes only. If F089 (structured logs) is in `spec/features/done/` when a stage starts, new lines follow its standard in `docs/code-patterns.md`.

A gap or a deviation that a worker finds is a question in its final message, not a choice. The coordinator decides from this "Input" or asks the owner.

## Facts checked (2026-11-13, at commit `3638a0c`)

- `outbox` (`db/migrations/20261106000001_telegram.sql:44`): `text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4096)`, `buttons jsonb NOT NULL DEFAULT '[]'`, `error_code` CHECK is a regex (`^[a-z0-9_]{1,40}$`), so `bad_view` needs no constraint change. The kind CHECK `outbox_kind_check` lists 11 kinds (`20261111000001_delete_mailbox.sql:2`). A Postgres `CHECK` passes on a null value, so `DROP NOT NULL` is enough to allow a null `text`.
- `delete_mailbox` (`20261111000001_delete_mailbox.sql`) deletes pending and sending digest rows and sets `text = '[removed]'` on sent and failed digest rows of the organization.
- `users.locale text CHECK (locale IN ('pl','en'))`, nullable (`20261112200001_auth_public.sql`, F082 stage 1, landed). `userLocales`, `UserLocale`, `userLocaleSchema` in `packages/core/src/tenancy.ts:11`. F082 B1: a user without a locale gets Polish mails (`spec/features/active/F082-s6b-public-login/plan.md:34`).
- `channels/notices.ts` (745 lines): `queue()` at line 108 calls `insertOutbox` with `message`. Nine producers: `detectUrgent`, `detectActionFailed`, `detectAuthError`, `detectSync` (two kinds), `detectApprovals`, `detectApprovalSets`, `detectSendResults`, `detectDelegationAnswered`, `queueMailboxRemovedNotices` (`MAILBOX_REMOVED_TEXT` from `channels/texts.ts:21`). The digest job (`channels/digest-job.ts:51`) queues `buildDigestMessage` output. `commands.ts:35` imports `SYNC_LATE_MS` from `./notices`. `telegram/runtime.ts:9` imports `detectNotices` from `../notices`. `web.ts:10` imports `queueMailboxRemovedNotices` from the channels index. `approvalViewFor` is exported but used only inside `notices.ts`.
- Renderer inputs: `renderUrgentNotice`, `renderAuthErrorNotice`, `renderSyncStaleNotice`, `renderSyncOkNotice`, `renderActionFailedNotice` (`packages/core/src/digest/notices.ts`); `renderApprovalRequest`, `renderApprovalSetRequest`, `renderSendResult`, `renderDelegationAnswered`, `approvalEdit` (`packages/core/src/digest/approvals.ts`). `renderApprovalRequest` takes `now` and `timeZone` but does not read them. `ApprovalView` (`packages/core/src/outgoing/sender.ts:18`) already holds a quote cut to `QUOTE_PREVIEW_CHARS` = 1500 code points.
- `aiTextFor` (`packages/core/src/digest/ai-text.ts`) reads `modelCategory` and `confidence` only for the category `unsure`; the urgent detector passes the category `urgent` and `summary: null`, so `{ reasonCode, reason }` decide its output. `describeActions` (`would-do.ts`) reads `type`, `status`, `folder`, `reverse`, `kind`, `delegateId` of each action.
- `cutText` (`packages/core/src/digest/text.ts`) replaces control characters with a space and lone surrogates with U+FFFD before a print.
- The sender (`channels/sender.ts`) fails a row older than 24 h (`OUTBOX_MAX_AGE_MS`) with `expired` before any send. `claimDueOutbox` parses `buttons` with `outButtonsSchema`. `markOutboxSent` sets `sent` with a `locked_at` guard.
- The tap edit (`channels/callbacks.ts`, the closure `edit`) reads `findOutboxByDedup(...).text` and calls `approvalEdit({ original, outcome, at: now, timeZone, ...extra })`; an empty original gives no edit. `docs/architecture.md` §4.5 line 356: "the approval message keeps its text and gets one line".
- `clearOutboxTexts` (`channels/repo.ts`, end of file) selects `text <> '[removed]'` for sent and failed rows and fails pending and sending rows with `[removed]`.
- Tests that read or write outbox text (counts of `insertOutbox(` calls): `channels-outbox` 9, `actions-schema` 5, `delegation-schema` 4, `delete-mailbox` 3, `channels-callbacks` 1, `channels-sender` 1, `mail-remove` 1; texts are read in `channels-notices` (helper `rows`, line 100), `channels-digest-job` (helper `outbox`, line 81), `channels-sender` (lines 135–136), `mail-remove` (lines 190–201, 419–420), `delete-mailbox` (helper `outboxText`, line 129), `retention-clear` (line 552), `telegram-schema` (lines 62, 269–271). Most go through one helper per file.
- **P1 (Zod probe, `.probe-f088/`, deleted).** Zod 4.6.7 (main checkout; `packages/core/package.json` asks `^4.1.12`): `z.iso.datetime()` accepts `Date.toJSON()` output (`2026-11-13T10:07:33.123Z`) and `…33Z`, refuses `…33+01:00`; with `.transform((value) => new Date(value))` the milliseconds come back exactly. `renderUrgentNotice` gives the same text for an input and for the same input after `JSON.stringify` and the schema parse. A Zod error message holds the path and the expected type, not the value; it is still never logged (D24).
- **P2.** `JSON.stringify` writes a lone surrogate as the escape `\ud800` (well-formed stringify).
- **P3 (typed registry probe).** The shape of D10 (`defineRenderer`, `satisfies { [K in NoticeKind]: NoticeRenderer<z.ZodType> }`, `NoticeView<K> = z.output<(typeof noticeRenderers)[K]["schema"]>`) compiles with `tsc` under `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`); a view of the wrong shape for its kind is a type error (`@ts-expect-error` held). `String.prototype.toWellFormed` is not in the ES2022 lib (TS2550), so the encoder uses a regex.
- **P4.** `renderUrgentNotice` with `emailId: "e1"` throws `bad email id` (`digest/callback.ts:75`): a renderer can throw.
- Bun 1.4.4 on this machine; CI uses Bun 1.3.14.

## Not verified

- That Postgres 16 refuses `\ud800` and `\u0000` inside a `jsonb` value (Postgres docs, § JSON types; not run here: no DB in a planning job). D15 removes both before the insert either way. Stage 03 test 9 inserts a view with a lone surrogate and a NUL through `queueNotice` and expects a row.
- Which migration file is the newest when stage 02 starts (F087 and F082 can add files). Stage 02 names the file by the build day and checks the sort order.
- That F086 stage 05 put § "Size and shape" into `docs/code-patterns.md`. Stage 06 checks it first.

## Done when

1. The four ticket acceptance lines on code hold: `noticeKinds` = renderer keys = detector kinds + `queuedBy` (unit tests of stages 01 and 05) = the `CHECK` lists (integration test of stage 02).
2. The sender renders a row with `text` null from `view`, `channel`, `detail` and `locale`; after the send, `outbox.text` and `outbox.buttons` equal the sent message (`channels-sender` test of stage 04).
3. A row whose view its renderer rejects becomes `failed` / `bad_view`; the log line holds the id and the kind only (`channels-sender` test of stage 04).
4. Every assertion on notice texts in `channels-notices`, `channels-digest-job`, `channels-callbacks` and `channels-sender` holds with the registry output; the diff of those test files changes only the row helpers and the queue shape (stage 03 and 04 diffs).
5. Retention and `delete_mailbox` clear `view` with `text` (`retention-clear`, `delete-mailbox` tests of stage 02).
6. `apps/server/src/modules/channels/notices.ts` is gone; no file in `apps/server/src/modules/channels/notices/` has more than 400 lines (`wc -l`).
7. `docs/code-patterns.md` has § "Notices are facts" and the checklist "Add a notice kind"; the styleguide has the short form (stage 06).
8. `bun run lint`, `bun run typecheck`, `bun run test:unit` and `bun run test:int` pass after each stage (the Proof).

## Rules for every stage

- Read `ticket.md`, this file and your one stage file. Build only your stage. A gap or a deviation is a question in your final message, not a choice.
- Texts do not change. If a test assertion on a notice text fails, the code is wrong, not the test. Change a test only where the stage file says so (row helpers, the queue shape).
- Imports across modules go through the module `index.ts` (`../../actions`, never `../../actions/repo`); `bun run lint` enforces it after F086. New files in `channels/notices/` import other modules as `../../<module>`. After a stage that adds or removes an import between two modules, run `bun run graph:modules`; in this ticket no stage should change `docs/diagrams/module-graph.*` (check `git status --short docs/diagrams` is empty).
- Logs (D24): never a view, a rendered text, a Zod error, a subject, an address or a name. Ids, kinds and codes only.
- Format only the files of your stage (`bunx prettier --write <files>`). Never run `bun run format` or `prettier --write .` (an S2 builder did, and the diff touched hundreds of files).
- No temporary files inside the worktree: `bun run lint` lints every `.ts` file. Use `/tmp/f088-sNN/`.
- Comments state the rule in one sentence and name an ADR or a ticket folder path if a source is needed. No bare codes (`D12`, `S4`, `F079`) in new comments (F086 standard).
- No secret, `.env` value, mail text or address in a log line, a test name or a commit message. Test data uses `example.test` addresses and marker strings.
- `bun run test:int` runs in your own DB (the prepare script makes it); no lock needed. Do not run `bun run test:e2e`.
- Only stage 02 adds a migration. No stage changes `bun.lock` or adds a dependency.
- Before each commit: `git diff --staged`; look for bugs, secrets, debug code and changes outside the stage.

## Proof

Each stage ends with this chain, after its last commit, with nothing after it (replace `NN`):

```
mkdir -p /tmp/f088-sNN && bun run lint > /tmp/f088-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f088-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f088-sNN/unit.log 2>&1 && bun run test:int > /tmp/f088-sNN/int.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed. In the final message, list as proven only what a saved log shows.

## Owner checkpoints and owner steps

- **Owner step O1, after stage 02 lands:** run `bun run db:migrate` on the shared dev DB (main checkout, no `test:int` running). The coordinator hands it over; no agent runs it.
- **Owner checkpoint C1, after stage 04 lands (the switch to send-time rendering):** a review job checks stages 02–04 together (review list below); the owner reads its verdict and says go for stages 05 and 06. Reason: stage 04 changes what every user receives.
- **Deploy note (no stage):** deploy the migration before the code of stage 03 or later (the code writes `view`). After stage 04 is deployed, a rollback of the code to a version before stage 04 sends rows whose `text` is null as empty messages (Telegram answers 400, the rows fail with `bad_request`); roll back only with the down migration of stage 02, or accept that pending notices fail.
- The owner may confirm or change the defaults in [questions.md](questions.md) at any time before the stage that uses them.

## Review

- Review job before the land (board reviewer: `spec/build.md` § TRACK, Sonnet 5.5, thinking high; the reviewer may run `bun run test:int` at the candidate commit): stage 02 `[risky]` (migration, retention, privileged function), stage 03 (every producer and its transaction), stage 04 `[risky]` (what users receive; the send path).
- After stage 04 lands: one group review of stages 02–04 for checkpoint C1.
- Stages 01, 05, 06 land on the worker's proof.

## Stages

| # | Stage | Risk | File |
| --- | --- | --- | --- |
| 01 | Core: notice kinds, strict view schemas, the renderer registry, encode, `renderNotice`, `renderNoticeEdit`, unit tests | normal | [stages/stage-01-renderer-registry.md](stages/stage-01-renderer-registry.md) |
| 02 | Migration `outbox_view`, `db:types`, repository reads and writes of the new columns, retention and `delete_mailbox` clear `view` | `[risky]` | [stages/stage-02-migration-and-repo.md](stages/stage-02-migration-and-repo.md) |
| 03 | Every producer queues `{ kind, view, locale }` through `queueNotice`; the row still stores the text rendered from the view | normal | [stages/stage-03-queue-facts.md](stages/stage-03-queue-facts.md) |
| 04 | The sender renders at send time; `text` stays null until sent; `bad_view`; the tap edit through the registry | `[risky]` | [stages/stage-04-sender-renders.md](stages/stage-04-sender-renders.md) |
| 05 | Detector registry: `channels/notices/<kind>.ts`, `detectForOrg` iterates, the detector completeness test | normal | [stages/stage-05-detector-registry.md](stages/stage-05-detector-registry.md) |
| 06 | Docs and standards: `docs/code-patterns.md`, styleguide, `docs/architecture.md` §4.5, §5, §7, `docs/modules.md` §3.8, ADR 0032 note | normal | [stages/stage-06-docs-and-standards.md](stages/stage-06-docs-and-standards.md) |

Order: one stage at a time, in number order. Each needs the one before it: 02 uses the core kind lists of 01 (repository parsing, the `CHECK` test); 03 needs the registry (01) and the columns (02); 04 needs the views that 03 queues; 05 splits the file that 04 changed; 06 names the files of 01–05. (The author's plan let stage 1 and 2 run in parallel; the `CHECK` test in stage 02 needs the core lists, so they run in order.)

## How to run (coordinator)

1. Start only when F086 is in `spec/features/done/` and the rule of `docs/product/stage-2/05-execution-plan.md` §2.4 allows a second Stage 2 ticket. Move this folder to `spec/features/active/` and commit it before the first spawn.
2. Stage 02 is a migration: spawn it only when no other job with a migration stage runs (F087 stage 1, F092 stage 1, any other ticket's migration). One `bun.lock` change at a time (none here).
3. For each stage NN (land a stage before you spawn a stage that needs it):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F088" \
  'Implement F088 stage NN. Read spec/features/active/F088-notices-as-facts/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: mkdir -p /tmp/f088-sNN && bun run lint > /tmp/f088-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f088-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f088-sNN/unit.log 2>&1 && bun run test:int > /tmp/f088-sNN/int.log 2>&1 && echo PROOF_OK. In the final message, list as proven only what a saved log shows.'
```

4. Stages 02, 03 and 04: start a review job on the stage branch before the land (`limen spawn --review --branch <stage branch> …` with the reviewer model). Land with `limen land --keep-open`; the land of stage 06 closes the ticket.
5. After the land of stage 02: hand owner step O1 to the owner. Before the land of stage 03: list open job branches that touch `channels/` (`limen jobs`); after the land, tell each to rebase (the `insertOutbox` shape changes). Same before the land of stage 05 (`notices.ts` is split).
6. After the land of stage 04: the group review of stages 02–04, then stop for checkpoint C1.
7. After each land, drop the job DB (`bun run db:worktree <name> --drop` from the main checkout, name printed by the prepare script).

## Planning progress

- [written] stage 01 · [written] stage 02 · [written] stage 03 · [written] stage 04 · [written] stage 05 · [written] stage 06
- [ ] cold review (`plan-review-1.md`)

## Cold review

Not run yet.

## Log

- 2026-11-13: plan input written by the ticket author from the architecture review.
- 2026-11-13: plan written by a planner job (Opus 5.5) from the author's input; probes P1–P4.
