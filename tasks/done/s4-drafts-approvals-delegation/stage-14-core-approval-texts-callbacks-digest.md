# s4-drafts-approvals-delegation — Stage 14

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 14 — Core: callback kinds, approval, set, result and answered texts, digest phrases and footer [risky]

Why risky: the approval message is what the user approves. It must show the recipient, the original sender with the warning, and the draft text, within the Telegram limits, every time.

- [x] **14.1 Callback kinds (D26)**
  - Goal: six new button payloads parse and encode within 64 bytes; forged data gives null.
  - Files: change `packages/core/src/digest/callback.ts`, `callback.test.ts`.
  - Interfaces:

    ```ts
    export type Callback =
      | FeedbackCallback // the S2 and S3 kinds: right, edit, pick, cancel, undo (the name stays)
      | { kind: "approve"; actionId: string }
      | { kind: "reject"; actionId: string }
      | { kind: "approve_set"; setId: string }
      | { kind: "reject_set"; setId: string }
      | { kind: "send_again"; actionId: string }
      | { kind: "delegation_done"; delegationId: string };
    export function encodeCallback(callback: Callback): string; // ap:, ar:, as:, rs:, ag:, dd: + uuid
    export function parseCallback(data: string): Callback | null;
    ```

  - Decisions: the prefixes `ap`, `ar`, `as`, `rs`, `ag`, `dd` with one uuid (39 bytes); `FeedbackCallback` keeps its name and shape (the S2 and S3 code compiles unchanged); `Callback` is the union.
  - Test: round trips for each kind; a forged `ap:not-a-uuid` → null; the S2 and S3 kinds still parse; every encoding ≤ 64 bytes.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: the handlers (stage 16).

- [x] **14.2 Approval, set, result and answered texts (D19, D20, D21, D24)**
  - Goal: pure renderers for the four S4 notices and the edits after a tap, with the exact words below and the length limits; the texts tell the truth for every send kind and for a server without UIDPLUS.
  - Files: create `packages/core/src/digest/approvals.ts`, `approvals.test.ts`; change `packages/core/src/digest/index.ts`.
  - Interfaces:

    ```ts
    export const APPROVAL_QUOTE_CHARS = 1500;
    export function renderApprovalRequest(input: {
      actionId: string;
      view: ApprovalView;
      now: Date;
      timeZone: string;
    }): OutMessage;
    export function renderApprovalSetRequest(input: {
      setId: string;
      items: {
        n: number;
        delegateName: string;
        address: string;
        subject: string | null;
        dueAt: Date | null;
        reminder: 1 | 2;
        task: string; // the reminder draft's payload task (marked text, ≤ 300)
      }[];
      timeZone: string;
    }): OutMessage;
    export type SendResultKind =
      | { kind: "sent"; sentCopy: "appended" | "found" | "failed"; draftRemoved: boolean }
      | { kind: "rejected_by_server"; stage: string; responseCode: number | null }
      | {
          kind: "failed";
          cause: "tries" | "content_soft" | "compose" | "bad_payload"; // from provider_result.stage (stage 12.1)
          code: string | null; // the response code or the nodemailer code
          tries: number; // actions.attempts after the last count
        }
      | { kind: "outcome_unknown" }
      | {
          kind: "expired";
          reason:
            | "timeout"
            | "draft_missing"
            | "not_notified"
            | "held_timeout"
            | "delegation_closed"
            | "policy_changed";
          draftRemoved: boolean;
        }
      | { kind: "rejected"; byName: string | null; draftRemoved: boolean };
    export function renderSendResult(input: {
      actionId: string;
      sendKind: DraftPayload["kind"];
      result: SendResultKind;
      recipient: { name: string | null; address: string };
      subject: string;
      synthetic: boolean;
    }): OutMessage;
    export function renderDelegationAnswered(input: {
      delegationId: string;
      delegateName: string;
      subject: string | null;
      receivedAt: Date;
      now: Date;
      timeZone: string;
      synthetic: boolean;
    }): OutMessage;
    export type ApprovalEditOutcome =
      | "approved"
      | "approved_held"
      | "rejected"
      | "expired"
      | "approved_set"
      | "rejected_set"
      | "done";
    export function approvalEdit(input: {
      original: string;
      outcome: ApprovalEditOutcome;
      heldBy?: "scope" | "paused" | "auth_error"; // only with approved_held (stage 16.1)
      at: Date;
      timeZone: string;
      actionId?: string;
      counts?: { done: number; skipped: number };
    }): OutMessage; // the edited message: the text and the buttons that stay
    ```

  - Decisions:
    - `renderApprovalRequest`, lines in order: `📤 Send? Delegation to <name> <address>` (name omitted when null; ` (inactive)` after the name when `view.recipientInactive`; clarification: `📤 Send? Question to the sender <address>`; reminder: `📤 Send? Reminder to <name> <address>`) + ` · 🧪 test` when synthetic; `From: <sender.label>` + ` · ⚠️ external sender` when `external` (omitted for a reminder); `Subject: <cleanSubject(subject)>`; `Due: <dueDate>` when set; empty line; `Draft:`; the body (`view.body`); when the quote exists: empty line, `Quoted original:`, the quote text after `chatQuoteText` (new in this file: `removeLinks` of `packages/core/src/triage/untrusted-text.ts` for scheme and `www.` links, then every bare domain token `/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi` → `[link]`; Telegram makes URLs, bare domains and addresses in a plain message tappable, so a phishing link of the original would become a link in the bot's own message: review round 2 N8, round 3; an address `x@firma.pl` becomes `x@[link]`, a file name `plik.pdf` becomes `[link]`: accepted in a preview), then `(links shown as [link]; the draft has them)` when a token was replaced, and `(quote cut; the draft has the full text)` when `quote.cut`; the last line `The system sends it after your tap. Do not send the draft from your mail client.` Buttons `[[📤 Send → approve], [✖️ Reject → reject]]` in one row. Length: when the text is longer than `MESSAGE_MAX_CHARS`, the quote is cut again to fit (`quoteCut(quote, remaining)`), and when even the body does not fit, the body is cut with `…` at `MESSAGE_MAX_CHARS − 200` with the line `(draft text cut; the full text is in the draft)` — a body that long cannot come from the templates (task ≤ 300), it is a guard. The recipient address and the sender label pass through `cutText(…, 80)`.
    - `renderApprovalSetRequest`: `📤 Send <n> reminders?` (n = 1: `📤 Send 1 reminder?`), per item two lines: `<n>. <delegateName> <address> — <cleanSubject> (due <formatDay(dueAt)>, reminder <k> of 2)` (`due` omitted when null) and `   Task: <cutText(task, 150)>` (review round 2 N25: the user sees what each reminder asks for, not only to whom), then the line `Each reminder is the fixed reminder template with this task; it quotes nothing.`, then `The system sends them after your tap.`, buttons `[[📤 Send all → approve_set], [✖️ Skip all → reject_set]]`. At most `CHASER_SET_LIMIT` = 10 items (the chaser never makes more per set, D23). Length: when the text is over `MESSAGE_MAX_CHARS`, the renderer cuts the task lines first (down to 40 characters each), then the subjects (down to 60), then the names (down to 40); it **never drops an item** (a "Send all" tap must never approve a reminder that the message did not show). More than 10 items → `RangeError` (a programming error; the detector skips the set with a warn line, stage 15.1, and the sends expire as `not_notified` after 7 days).
    - `renderSendResult` texts (`<to>` = `name <address>` or `<address>`; `<subject>` = `cleanSubject`; ` · 🧪 test` after the first line when synthetic). The second line depends on the send kind: `<closing>` = `The delegation was cancelled.` for `delegation`, nothing for `clarification`, `The delegation stays open.` for `reminder`. `<draft>` = `The draft was removed.` when `draftRemoved`, else `The draft stays in Drafts.`:
      - `sent` → `✅ Sent to <to> · <subject>` + (`\nNo copy in Sent: the server refused the copy.` when `sentCopy = "failed"`) + (`\nThe draft stays in Drafts (no UIDPLUS on this server).` when `!draftRemoved`);
      - `rejected_by_server` → `❌ Not sent to <to> · <subject>\nThe mail server refused it (<stage>, code <responseCode>). The draft stays in Drafts. <closing>`;
      - `failed` (review round 2 N10: the text names the real cause and the try count) → `❌ Not sent to <to> · <subject>\n<cause>. The draft stays in Drafts. <closing>` with `<cause>` by `cause`: `tries` → `The send failed <tries> times (<code>)`; `content_soft` → `The mail server refused the content for now (code <code>); the system never retries after the content`; `compose` → `The mail could not be built <tries> times`; `bad_payload` → `The stored send data is not valid; nothing was sent`. The button `[📤 Send again → send_again]` for `tries`, `content_soft` and `compose` (`sendAgain` accepts `smtp_error`); none for `bad_payload` (a resend would fail the same way; `sendAgain` answers `not_failed`);
      - `outcome_unknown` → `⚠️ Unknown whether the mail to <to> went out · <subject>\nThe connection broke after the content was sent. Check Sent or ask the recipient before you send again. <closing>` + `[📤 Send again]`;
      - `expired` `timeout` → `⌛ Not sent: the approval expired (48 h) · <subject>\n<closing> <draft>`; `draft_missing` → `❌ Not sent: the draft could not be created · <subject>\n<closing>`; `not_notified` → `⌛ Not sent: no approval request could go out within 7 days (no linked owner, or the draft was not created) · <subject>\n<closing> <draft>` (review round 2 N20: the cause can also be a draft held by `ACTIONS_SCOPE` or a paused mailbox); `held_timeout` → `⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE or the mailbox state) · <subject>\n<closing> <draft>` (D22 (d)); `delegation_closed` → `⌛ Not sent: the delegation was closed · <subject>\n<draft>`; `policy_changed` → `⌛ Not sent: the setting was changed · <subject>\n<closing> <draft>`;
      - `rejected` → `✖️ Rejected` + (` by <byName>` when given) + ` · <subject>\n<closing> <draft>`.
        No buttons except the named `[📤 Send again]` buttons.
    - `renderDelegationAnswered`: `📩 <delegateName> answered · <cleanSubject>` + ` · 🧪 test`; `Received <formatClock(receivedAt)>. Tap Done when the task is closed.`; button `[[✅ Done → delegation_done]]`.
    - `approvalEdit`: the text is `original + "\n\n" + line` with `approved` → `⏳ Approved <HH:MM>, sending.`; `approved_held` → `⏳ Approved <HH:MM>. <held>; /status shows it. It expires 48 h after the tap if it is still held.` with `<held>` by `heldBy`: `scope` → `Sending is held by SEND_SCOPE on the server`; `paused` → `The mailbox is paused, so the send waits`; `auth_error` → `The mailbox login fails, so the send waits` (review round 2 N17), and the buttons `[[✖️ Reject → reject(actionId)]]` (the one case that keeps a button: a held send can still be cancelled, D26); `rejected` → `✖️ Rejected <HH:MM>.`; `expired` → `⌛ Expired <HH:MM>. The mail was not sent.`; `approved_set` → `⏳ Approved <HH:MM>: <done> sending, <skipped> skipped.`; `rejected_set` → `✖️ Skipped <HH:MM>: <done> rejected, <skipped> skipped.`; `done` → `✅ Done <HH:MM>.`; every other outcome has `buttons: []`; the result is cut to `MESSAGE_MAX_CHARS` from the start of `original` (never the new line).
  - Test (`approvals.test.ts`): (1) a delegation request with an external sender → the lines above, the last line about the mail client, two buttons with `ap:` and `ar:` data, the text ≤ 4096; an inactive recipient → `(inactive)`; (2) a quote of 3000 characters → cut to ≤ 1500 with the cut line; (2b) a quote with `https://evil.test/pay`, `www.evil.test` and `evil.test/pay` → three `[link]` in the text and the line `(links shown as [link]; the draft has them)`; a quote without a link → no such line; a body of 5000 characters (guard) → the cut line and ≤ 4096; (3) a clarification request → the `Question to the sender` line, no `Due`; a reminder → no `From` line; (4) synthetic → `🧪 test`; (5) the set request with two items (address and `Task:` line in each) and one without a due date; 10 items with names of 100, subjects of 200 and tasks of 300 characters → all 10 items listed, the text ≤ 4096; 11 items → `RangeError`; (6) every `renderSendResult` kind renders the exact first line and the right second line per `sendKind` (a table test: kinds × `delegation | clarification | reminder`), `draftRemoved` false → `The draft stays in Drafts.`; `failed` with each `cause` (`tries` with `tries` 3, `content_soft` with code `451`, `compose`, `bad_payload`) → its cause line; `outcome_unknown` and `failed` with `tries`, `content_soft`, `compose` have the `ag:` button, `bad_payload` and the others none; `expired` `held_timeout` and `not_notified` → their lines; (7) the answered notice with the `dd:` button; (8) `approvalEdit` for each outcome; `approved_held` keeps one `ar:` button, the others none, and its line differs per `heldBy`; a 4090-character original stays ≤ 4096 after the edit; (9) a sender label with a link → `[link]` (through `senderLabel`/`cutText`: the S2 helpers), no control characters.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: the detectors (stage 15), the handlers (stage 16).

- [x] **14.3 Digest phrases, the delegations footer, the reports wiring (D25, D33)**
  - Goal: a digest line tells what happens with a delegation mail (draft, approval, sent) and the footer counts open and overdue delegations.
  - Files: change `packages/core/src/digest/would-do.ts`, `would-do.test.ts`, `digest.ts`, `digest.test.ts`, `ai-text.ts`, `ai-text.test.ts`; change `apps/server/src/modules/actions/repo.ts` (`listActionsForEmails` selects `payload->>'kind'` and `payload->>'delegate_id'`; `listDraftTasks(db, ctx, emailIds)` returns `payload->>'task'` of `create_draft` originals), `apps/server/src/modules/reports/digest.ts`, `apps/server/test/integration/reports-digest.test.ts`; `docs/modules.md` is updated in stage 21.
  - Interfaces:

    ```ts
    export interface ActionView { …S3 fields…; kind: "delegation" | "clarification" | "reminder" | null; delegateId: string | null }
    export function describeActions(actions: readonly ActionView[], names?: ReadonlyMap<string, string>): string;
    export interface DigestInput { …; delegations?: { open: number; overdue: number } }
    export interface AiTextInput { …; task?: string | null } // aiTextFor prefers the task for `delegation`
    ```

  - Decisions:
    - `describeActions`: a `create_draft` original → the phrase by kind: `draft a delegation to <name>` (`names.get(delegateId)`, else `a delegate`), `draft a question to the sender`, `draft a reminder to <name>`; with the tense table (`logged` → `would`, `ready` → `will`, `applying` → `will`, `applied` → `done:`, `undone` → nothing: an `undone` draft after a send is not shown, so the line reads from the send; `expired` → nothing; `failed` → `failed:`). A `send` row → a phrase without a tense: `logged` → `would ask you to send it`, `awaiting_approval` → `waits for your approval`, `approved` → `approved, sending`, `applying` → `sending`, `applied` → `sent`, `rejected` → `rejected`, `expired` → `not sent (approval expired)`, `failed` → `not sent (failed)`. Reverse rows are skipped (S3 D14). The join with `; ` as today; a line with only a `send` phrase reads `waits for your approval`.
    - `renderDigest`: after the other footer lines and before the shadow line: `👥 Delegations: <open> waiting for a reply, <overdue> overdue` when `open + overdue > 0`.
    - `reports/digest.ts`: `names = await listDelegateNames(db, ctx, ids)` for the delegate ids found in the action views (the `delegation` index; `reports → delegation` edge, modules §2), `delegations = await countOpenDelegations(db, ctx)`; both passed to the renderer. The AI text of a `delegation` line = the task from the draft payload when a draft exists (`listDraftTasks`), else the reason (today's `aiTextFor`).
  - Test: `would-do.test.ts`: the phrases above, one per status, with and without a name; an `undone` draft plus an `applied` send → `sent`. `digest.test.ts`: the footer with counts; absent when both are 0. `ai-text.test.ts`: `delegation` with a task → the task. `reports-digest.test.ts`: a delegation mail with a `ready` draft and an `awaiting_approval` send → the line has `will draft a delegation to Anna Nowak; waits for your approval` and the task as the 💬 text; the footer counts from two delegation rows (`sent`, `overdue`).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass.
  - Out of scope: `/status` (stage 16).
