# F088 stage 06 — Docs and standards

Part of [`../plan.md`](../plan.md). Decisions: D1–D24 as built. Needs stage 05 landed (the text names its files). Docs only, no code. Two steps. The land of this stage closes the ticket.

## Step 1 — `docs/code-patterns.md` and the styleguide

**Goal.** The standard "notices are facts" and the checklist "add a notice kind" (ticket acceptance line 6; review §7 standard 5; `07-foundation-plan.md` §3 step 4: "The last stage of each ticket updates `docs/code-patterns.md` and `.agents/limen/styleguide.md` with its standard").

**Files.** `docs/code-patterns.md`, `.agents/limen/styleguide.md`.

**Precondition.** `grep -n "## Size and shape" docs/code-patterns.md` prints one line (F086 wrote it). If it prints nothing, put the new section after § "Side effects" instead, and report it in the final message.

**Interfaces.** Before you write, check each file and function name in the text below against the code (`ls`, `grep`); if one differs, use the real name and report it.

1. New section in `docs/code-patterns.md`, directly after § "Size and shape" (write the text as given; you may fix line wrap):

```markdown
## Notices are facts

A module that has something to tell a user queues facts. It never builds the text of a channel (ADR 0032 point 5).

- A notice enters the outbox only through `queueNotice` (`apps/server/src/modules/channels/notice-queue.ts`) with `{ userId, locale, kind, view, dedupKey }`. The view is the input of the kind's renderer: ids, counts, dates, and the strings from mail data or from users that the text prints (subject, sender, names). It holds no phrase of ours: a fixed word or sentence comes from the renderer, so a new locale or a new channel changes only the renderer.
- Each kind has a strict view schema (`noticeViewSchemas`, `packages/core/src/notices/views.ts`): no field that the renderer does not print. A view holds mail-derived text: it follows the retention of `outbox.text` (`clearOutboxTexts`, `docs/architecture.md` §7) and never reaches a log line, an error text or a test name.
- `queueNotice` renders the view once as a check. A view that does not render never enters the outbox; the producer marks its source row in the same transaction, so the mark rolls back and the event is tried again.
- The sender renders when it sends: `renderNotice(kind, view, { channel, detail, locale })` from `@ea/core`. `outbox.text` and `outbox.buttons` are the cache of the sent message (null and `[]` until the send). A row whose view does not render becomes `failed` / `bad_view`.
- A clock in a view is a fact of the queue time (`now`, `timeZone`): a notice held by the quiet hours prints the same text when it goes out.
- The edit after a tap keeps the stored text of the card and adds one status line (`renderNoticeEdit`); it never renders the card again.
- Texts are `en` today. The row's `locale` comes from `users.locale` (null = `pl`, as the auth mails); a renderer selects the `pl` text when E7-T1 adds it.

### Add a notice kind

1. Core: add the kind to `noticeKinds` (`packages/core/src/notices/kinds.ts`), a strict view schema to `noticeViewSchemas` (`views.ts`) and an entry with a `telegram.full` function to `noticeRenderers` (`renderers.ts`). Unit test: the exact text for one fixed view.
2. Migration: add the kind to `outbox_kind_check` (drop and add the constraint, as `db/migrations/20261111000001_delete_mailbox.sql` does); the `down` part deletes the rows of the kind first. A kind that needs `email_id`, `mailbox_id` or `digest_id` gets that check too.
3. Server: one detector file `apps/server/src/modules/channels/notices/<kind>.ts` that exports a `Detector` listed in `detectors` (`notices/index.ts`), or, for a producer outside the notifier, an entry in `queuedBy`. The producer calls `queueNotice`.
4. Tests: `channels/notices/registry.test.ts` and the `CHECK` test in `apps/server/test/integration/telegram-schema.test.ts` fail until steps 1–3 are complete. Add an integration case in `channels-notices.test.ts`: one row per member, no second row on a second run.
5. Docs: the `outbox` row of `docs/architecture.md` §5 (kind, dedup key) and the `channels` table of `docs/modules.md` §3.8.
```

2. `.agents/limen/styleguide.md`:
   - § Prefer, add at the end: "- Notices are facts: a producer calls `queueNotice({ kind, view, locale })`; the sender renders with `renderNotice` from `@ea/core`. A new kind follows the checklist in `docs/code-patterns.md` § Notices are facts."
   - § Avoid, add at the end: "- Channel text (Telegram or other) built outside a renderer in `packages/core/src/notices/`. A view, a rendered text or a Zod error in a log line."

**Decisions.** D10, D13–D18, D24.

**Test.** Markdown only.

1. `grep -n "## Notices are facts\|### Add a notice kind" docs/code-patterns.md` prints two lines.
2. `grep -c "queueNotice" .agents/limen/styleguide.md` prints `1`.
3. `wc -l < .agents/limen/styleguide.md` prints a number under `1000`.
4. Each path in the new text exists: `ls apps/server/src/modules/channels/notice-queue.ts packages/core/src/notices/views.ts packages/core/src/notices/kinds.ts packages/core/src/notices/renderers.ts apps/server/src/modules/channels/notices/index.ts apps/server/src/modules/channels/notices/registry.test.ts`.

**Check.** `bunx prettier --write docs/code-patterns.md .agents/limen/styleguide.md`, then `bunx prettier --check` on both.

**Done when.** Tests 1–4 hold.

**Out of scope.** The locale standard of the review §7 point 7 (E7-T1 adds it with the `pl` texts). Other sections.

## Step 2 — Architecture, modules and ADR 0032

**Goal.** The architecture and module docs describe the outbox as it is now.

**Files.** `docs/architecture.md`, `docs/modules.md`, `docs/decisions/0032-phone-channel-push-and-telegram-detail.md`.

**Interfaces.** Edits (find each line by the quoted words; line numbers are from 2026-11-13 and may move):

1. `docs/architecture.md` §5, the `outbox` row (line 467): after `digest_id,` write `view jsonb (the facts of the notice: the input of its renderer), channel (\`telegram\`), locale (\`pl\` / \`en\`), detail (\`full\`), text (the sent text; null until the send), buttons jsonb (the sent buttons),` in place of `text, buttons jsonb,`; add `bad_view` to the `error_code` list. Keep the rest of the row.
2. `docs/architecture.md` §7, the retention row "Message text" (line 669): `` `outbox.text`, `outbox.view` (digests and notices) ``. In the paragraph after the table, the sentence "A `pending` or `sending` `outbox` row older than 90 days becomes `failed` / `expired` and loses its text." ends "loses its text and its view."
3. `docs/architecture.md` §7 "Delete" (lines 676–680): "clears the text of the digest rows" → "clears the text and the view of the digest rows"; "sets the text of sent and failed digest rows to `[removed]`" → "sets the text of sent and failed digest rows to `[removed]` and their view to `{}`".
4. `docs/architecture.md` §6.2 (line 591): after "Messages to the user are rows in the `outbox` table (§5)." add "A row holds the facts of the notice; the sender renders its text when it sends (ADR 0032 point 5, `docs/code-patterns.md` § Notices are facts)."
5. `docs/architecture.md` §4.5 "The edit after the tap" (line 356): after "the approval message keeps its text" add "(the stored text of the sent card)".
6. `docs/modules.md` §3.8 table: the row `notices.ts` becomes `notices/` with the text "The detector registry: one file per detector (`urgent.ts`, `action-failed.ts`, `auth-error.ts`, `sync.ts`, `approval.ts`, `approval-set.ts`, `send-result.ts`, `delegation-answered.ts`) and `mailbox-removed.ts`; `index.ts` lists them in `detectors` and runs them per organization (`detectNotices`)", followed by the old text from "urgent, `auth_error`, …" on; a new row `notice-queue.ts`: "`queueNotice`: the only producer path into `outbox` (view, locale; a check render)"; the row `sender.ts` gets at its start "renders each row from its view (`renderNotice` of `@ea/core`) and stores the sent text;". After the "Built in S6a" bullet, add: "- **Built in F088:** notices are facts: `outbox.view`, `channel`, `locale`, `detail`; renderers in `packages/core/src/notices/`; the detector registry `notices/`; `docs/code-patterns.md` § Notices are facts."
7. ADR 0032, after the line "- Amends: …" in the header: "- Point 5 built by `spec/features/done/<YYYY-MM>/F088-notices-as-facts/` (the outbox stores the view, the sender renders). The status stays proposed until E9b." `<YYYY-MM>` is the month of your build: the land of this stage moves the folder to `done/<YYYY-MM>/`.

**Decisions.** D2, D8, D17, D18, D19, D21.

**Test.**

1. `grep -n "outbox.view" docs/architecture.md` prints the retention row.
2. `grep -n "bad_view" docs/architecture.md` prints the §5 row.
3. `grep -n "notice-queue.ts" docs/modules.md` prints the new row.
4. `grep -n "F088" docs/decisions/0032-phone-channel-push-and-telegram-detail.md` prints one line.

**Check.** `bunx prettier --write` and then `bunx prettier --check` on the three files (the architecture tables are wide; Prettier re-pads them, which is expected).

**Done when.** Tests 1–4 hold; step 1 tests hold; the Proof of `plan.md` with `NN` = `06` ends with `PROOF_OK`.

**Out of scope.** `docs/product/stage-2/*` (the coordinator edits the stage count in `07-foundation-plan.md`). `spec/build.md`.
