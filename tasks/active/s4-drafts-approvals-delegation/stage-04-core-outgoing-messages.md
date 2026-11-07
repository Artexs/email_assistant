# s4-drafts-approvals-delegation — Stage 4

Part of [`../s4-drafts-approvals-delegation.md`](../s4-drafts-approvals-delegation.md). Read that file's "Input" and "Rules for every step" first.

## Stage 4 — Core: outgoing message builder, templates, quote, external-sender rule [risky]

Why risky: this text goes to a person outside the system. The builder is the only place that turns a payload into a mail; it must never place LLM text in a header or a recipient, and the approval message must show exactly what goes out.

- [x] **4.1 `buildOutgoingMessage`, the templates and the quote (D8)**
  - Goal: a pure function turns a draft payload plus the original mail into a complete outgoing message (headers and text), the same bytes every time for the same input.
  - Files: create `packages/core/src/outgoing/message.ts`, `message.test.ts`, `templates.ts`, `templates.test.ts`, `quote.ts`, `quote.test.ts`, `index.ts`; change `packages/core/src/index.ts` (`export * from "./outgoing"`).
  - Interfaces:

    ```ts
    export interface OutgoingAddress {
      name: string | null;
      address: string;
    }
    export interface OutgoingMessage {
      messageId: string;
      date: Date;
      from: OutgoingAddress;
      to: OutgoingAddress[];
      subject: string;
      text: string; // parts.body + "\n\n" + parts.quote (when a quote exists)
      inReplyTo: string | null;
      references: string[];
      headers: { "X-EA-Action-Id": string };
      parts: { body: string; quote: string | null };
    }
    export interface OriginalMail {
      fromAddress: string | null;
      subject: string | null;
      receivedAt: Date;
      messageId: string | null;
      inReplyTo: string | null;
      references: string[]; // emails.references_header split on whitespace
      bodyText: string | null;
    }
    export interface BuildInput {
      draft: DraftPayload;
      draftActionId: string;
      createdAt: Date;
      mailbox: { address: string };
      owner: { displayName: string };
      organization: { styleText: string | null; timezone: string };
      original: OriginalMail;
    }
    export function buildOutgoingMessage(input: BuildInput): OutgoingMessage;
    export function outgoingMessageId(draftActionId: string, mailboxAddress: string): string; // `<ea-${id}@${domain}>`
    export function outgoingSubject(kind: DraftPayload["kind"], originalSubject: string | null): string;
    export const QUOTE_MAX_CHARS = 8000;
    export function quoteOriginal(original: OriginalMail, language: "pl" | "en", timezone: string): string;
    export const QUOTE_PREVIEW_CHARS = 1500;
    export function quoteCut(quote: string, max?: number): { text: string; cut: boolean };
    export function renderTemplate(
      kind: DraftPayload["kind"],
      language: "pl" | "en",
      fields: {
        task?: string;
        question?: string;
        dueDate: string | null;
        senderLabel: string;
        dateLabel: string;
        signature: string;
      }
    ): string;
    ```

  - Decisions:
    - `messageId` = `outgoingMessageId(draftActionId, mailbox.address)`: the domain is the part after the last `@` of the mailbox address, lower-cased; `date` = `createdAt`. `from` = `{ name: owner.displayName, address: mailbox.address }`. `to` = `[{ name: draft.delegate_name ?? null, address: draft.to[0] }]` (clarification: `name` null). `headers["X-EA-Action-Id"]` = `draftActionId`.
    - `outgoingSubject`: the original subject one line (`cutText(subject, 200)`, `(no subject)` when null or empty); `delegation` → `Fwd: <s>` unless `s` already starts with `fwd:` or `fw:` (case-insensitive); `clarification` → `Re: <s>` unless it starts with `re:` or `odp:`; `reminder` → `Re: ` + the delegation subject (`outgoingSubject("delegation", s)`) unless it starts with `re:`.
    - Threading: `delegation` → `inReplyTo` null, `references` = `[...original.references, original.messageId]` without nulls and duplicates; `clarification` → `inReplyTo` = `original.messageId`, `references` as for delegation; `reminder` → `inReplyTo` = `draft.thread.in_reply_to`, `references` = `draft.thread.references`.
    - `renderTemplate` (exact texts; `\n` line ends; the composer makes CRLF):
      - delegation, pl: `Dzień dobry,\n\nprzekazuję do realizacji: <task>\n` + (`Termin: <dueDate>\n` when set) + `Oryginalna wiadomość od <senderLabel> z <dateLabel> jest poniżej.\n\n<signature>`; en: `Hello,\n\nplease take care of this: <task>\n` + (`Due: <dueDate>\n`) + `The original message from <senderLabel> of <dateLabel> is below.\n\n<signature>`.
      - clarification, pl: `Dzień dobry,\n\ndziękuję za wiadomość. Zanim przekażę sprawę dalej, potrzebuję jeszcze jednej informacji: <question>\n\n<signature>`; en: `Hello,\n\nthank you for your message. Before I can hand it on, I need one more thing: <question>\n\n<signature>`.
      - reminder, pl: `Dzień dobry,\n\nprzypominam o zadaniu: <task>\n` + (`Termin minął: <dueDate>.\n` when set) + `Proszę o krótką informację o stanie prac.\n\n<signature>`; en: `Hello,\n\na reminder about this task: <task>\n` + (`The due date <dueDate> has passed.\n`) + `Please send a short status.\n\n<signature>`.
      - `signature` = `styleText` trimmed when not empty, else `owner.displayName`. `senderLabel` = `original.fromAddress ?? "(unknown sender)"` (the bare address: `MessageMeta.from` is the address); `dateLabel` = `formatDay(receivedAt, timezone)` + ` ` + `localDateTime(receivedAt, timezone).time`. `dueDate` = the payload `due_date` as `YYYY-MM-DD` (`""` → null). The task and the question pass through `markUntrustedText` once more (idempotent) and get their line breaks collapsed to spaces (a header-like line in LLM text cannot start a new paragraph that looks like a header).
    - `quoteOriginal`: pl header `--- Oryginalna wiadomość ---\nOd: <from>\nData: <dateLabel>\nTemat: <subject>\n\n`, en `--- Original message ---\nFrom: …\nDate: …\nSubject: …\n\n`; then the body with `\r\n` and `\r` normalized to `\n`, cut to `QUOTE_MAX_CHARS` with ` […]` appended when cut, `(no text)` when null or blank, each line prefixed `> `. The subject line is `cutText(subject, 200)`; the from is the address as stored. The quote is sender text: it is quoted, not cleaned (the delegate must see the original).
    - `buildOutgoingMessage`: `parts.body` = the template; `parts.quote` = the quote for delegation and clarification, null for reminder; `text` = `body` + (`\n\n` + quote when present). Nothing in `text` comes from the LLM except `task` / `question` inside the template line. `quoteCut(quote, QUOTE_PREVIEW_CHARS)` serves the approval message (D19): cut on a line end when possible, `{ cut: true }` when shortened.
  - Test: `message.test.ts` (fixed dates, `Europe/Warsaw`): (1) a delegation draft → `messageId` `<ea-<id>@interia.pl>` for `user@interia.pl`, `from` with the display name, `to` with the delegate name and address, subject `Fwd: Oferta`, `inReplyTo` null, `references` = the original chain plus its id, the header, `text` with `przekazuję do realizacji: <task>`, `Termin: 2026-11-10` and the quote; (2) the same input twice → deep-equal messages; (3) a subject that starts with `FW:` keeps it; a null subject → `Fwd: (no subject)`; (4) clarification → `Re: <s>`, `inReplyTo` = the original id, `to` = the sender, en text with `I need one more thing`; a subject that starts with `Odp:` keeps it; (5) reminder → `Re: Fwd: <s>`, `inReplyTo` and `references` from `draft.thread`, no quote, `Termin minął: <date>.`; (6) `styleText` null → the signature is the display name; `"  "` → the display name; `"Pozdrawiam, Artek"` → used; (7) a task with `Odwiedź http://x.test i zadzwoń 600 100 200` → the text has `[link]` and `[phone]`; a task with `\n\nSubject: hacked` → one line; (8) `references` without duplicates when the original id is already in the chain. `quote.test.ts`: the header block in pl and en; `> ` on every line; CRLF normalized; a 9000-character body → 8000 + ` […]`; null body → `> (no text)`; `quoteCut` on a 2000-character quote cuts at a line end ≤ 1500 and sets `cut`; a short quote is unchanged with `cut` false. `templates.test.ts`: every kind × language renders; the due line is absent when `dueDate` is null.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: the MIME bytes (stage 5), the approval text (stage 14).

- [x] **4.2 External-sender rule and the approval text model (D8, D19)**
  - Goal: a pure rule says when the original sender counts as external; a pure model holds what the approval message shows, so the notice renderer (stage 14) and the tests share it.
  - Files: create `packages/core/src/outgoing/sender.ts`, `sender.test.ts`; change `packages/core/src/outgoing/index.ts`.
  - Interfaces:

    ```ts
    export function isExternalSender(
      from: string | null,
      ctx: { internalAddresses: readonly string[]; whitelisted: boolean; vip: boolean }
    ): boolean;
    export interface ApprovalView {
      kind: DraftPayload["kind"];
      recipient: OutgoingAddress;
      sender: { label: string; external: boolean } | null; // null for a reminder
      recipientInactive: boolean; // the delegate row is inactive (D6)
      subject: string;
      dueDate: string | null;
      body: string; // parts.body
      quote: { text: string; cut: boolean } | null;
      synthetic: boolean;
    }
    export function approvalViewOf(
      message: OutgoingMessage,
      input: {
        draft: DraftPayload;
        original: OriginalMail;
        external: boolean;
        synthetic: boolean;
        recipientInactive: boolean;
      }
    ): ApprovalView;
    ```

  - Decisions:
    - `isExternalSender`: `from` null → true; `whitelisted` or `vip` → false; else external unless `from` (trimmed, lower-cased) equals one of `internalAddresses` (lower-cased: the organization's mailbox addresses and its active delegates' addresses, which the caller passes). The domain plays no role: at a public provider anyone can register an address in the mailbox's domain, and a `From` header can be forged, so a shared domain proves nothing (reviewer finding 9).
    - `approvalViewOf`: `sender.label` = `senderLabel(original.fromAddress)` (`digest/text.ts`), `quote` = `quoteCut(message.parts.quote)` when present; `dueDate` from the draft; `recipient` = `message.to[0]`.
  - Test: `sender.test.ts`: `a@interia.pl` with `internalAddresses: ["b@interia.pl"]` → true (same domain, not internal); `b@interia.pl` → false; `B@Interia.pl` → false (case); a delegate address in the list → false; whitelisted → false; VIP → false; null → true; an empty list → true. `approvalViewOf` on the stage 4.1 delegation message → the view with `external` and `recipientInactive` as given, the cut quote and the due date.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`.
  - Done when: the tests pass.
  - Out of scope: the Telegram text (stage 14).
