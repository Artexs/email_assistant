# F115 stage 10 — Switch and profile API

Part of [`../plan.md`](../plan.md). Needs 07.

The owner turns reply drafts on per mailbox and edits the mailbox's display name, signature and writing style through typed routes and the CLI. The web card is stage 11.

## Step 1 — The switch

- **Goal:** the mailbox settings route and CLI that set `tool_switches` accept `reply_drafts` (owner only, as the other switches). Turning it off closes open reply sends of the mailbox as `policy_changed` in the same transaction (the closing rule that setters use for `create_draft`). Turning it on makes nothing retroactive: the scan of stage 07 only takes mail of the last 7 days that has no `auto` request, so mail of the last 7 days does get drafts. Default: accepted (an owner who turns it on wants drafts for open mail).
- **Decisions:** D12. The switch is independent of `create_draft` (PD-082). The settings version changes as for other switches, so a running triage batch retries. D19: the guard sits in the service `setToolSwitch` (`config/service.ts`), which the route and the CLI both call: `reply_drafts: true` on a mailbox with `oauth_provider` set → refused with `oauth_mailbox` (route 400 `validation`, field `reply_drafts`; CLI exit 1); false is always accepted. `oauth_provider` is set only at insert, so a mailbox never turns OAuth later.
- **Test (integration):**
  1. Owner sets `reply_drafts: true` → stored; a member → 403.
  2. Two open reply sends; owner sets it false → both `expired` / `policy_changed`; an open delegation send stays.
  3. `create_draft` false and `reply_drafts` true → reply requests are made (stage 07 scan).
  4. A Microsoft OAuth mailbox: `reply_drafts: true` → 400, nothing stored; `false` → stored. The same through the CLI `mailbox-settings` → exit 1, nothing stored.

## Step 2 — Profile routes

- **Goal:** `GET /api/mailboxes/:id/profile` (member) → `{ displayName, signature, writingStyle, fallbackName, fallbackSignature }` (the D13 fallbacks, so the card can show what is used); `PUT` (owner) `{ displayName?, signature?, writingStyle? }` → the stored row. Each with `apiDoc`. CLI `bun run mailbox:profile --mailbox-id <id> [--display-name …] [--signature-file …] [--style-file …]` calls the same service function (ADR 0023).
- **Decisions:** text through `cleanUserText`; display name one line, 1–100; signature ≤ 1,000 multi-line; writing style ≤ 1,000 multi-line; an empty string stores null (= fallback). The display name may not contain `<`, `>`, `"`, `@` or a line break (header safety). Audit `mailbox.profile_changed` with the changed field names, never the text. A unknown or foreign mailbox → 404.
- **Test (integration):**
  1. PUT `{ displayName: "Anna Nowak" }` → GET shows it; the next draft has `From: "Anna Nowak" <…>` (stage 04 reader).
  2. PUT `{ displayName: "A <x@y>" }` → 400 `validation`.
  3. PUT `{ signature: "" }` → null; GET `fallbackSignature` = org `style_text`.
  4. Writing style of 1,001 characters → 400.
  5. Org B's mailbox id → 404.
  6. The audit row holds `["display_name"]` and no text.

## Step 3 — Preview

- **Goal:** `POST /api/mailboxes/:id/profile/preview` (owner) with `{ displayName?, signature?, writingStyle? }` (unsaved values) → `{ body }`: one drafter call on a fixed sample mail (pl or en by the owner's locale; the sample mail is a constant in `packages/core/src/replies/`, no real mail). It counts in the cap like a tap (100%) and writes one `llm.call` row without `email_id`.
- **Decisions:** at most 10 previews per mailbox per day (count the `llm.call` rows with prompt version `drafter-v1` and no `email_id`), then 429 `preview_limit`. The answer passes `checkReplyBody`; a failure → 200 `{ kind: "failed", reason }`.
- **Test:**
  1. Preview with a fake LLM → a body; one `llm.call` row.
  2. The 11th preview of the day → 429.
  3. A member → 403.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the web card (11), samples on real mail (16).
