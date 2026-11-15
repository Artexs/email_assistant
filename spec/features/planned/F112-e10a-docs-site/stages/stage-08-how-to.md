# F112 stage 08 — How-to guides (en)

Part of [`../plan.md`](../plan.md). Read P2, D7, D8 and stage 07 § "Shared rules for content stages". Needs stage 07.

One step. Markdown about 400 lines.

## Step 1 — How-to pages

- **Goal:** one short page per task a user does today.
- **Files:** `apps/docs/src/content/docs/how-to/*.mdx`, `site-map.test.ts`; the tutorial's "Next steps" links (stage 07 left them as text).
- **Pages** (id · task · capabilities). Before each page, check that its feature has no default-off flag in `packages/core/src/features.ts`; a flagged feature gets no page (P2), and the final message names it.
  1. `how-to/approve-a-send` · approve or reject a draft that waits in Telegram; what "Send again" and "It went out" do · `drafts-and-send`.
  2. `how-to/delegate-and-follow-up` · what a delegation is, who the delegates are (the operator adds them today: say so), the reminder set (`📤 Send all`, `✖️ Skip all`), close with `✅ Done` · `delegation`.
  3. `how-to/undo-a-move` · `↩️ n` in the digest and Undo in Activity; what Undo cannot bring back · `actions-and-undo`.
  4. `how-to/correct-a-category` · `✅ n`, `✏️ n` in Telegram and the feedback buttons in Activity; what the system does with them · `triage`.
  5. `how-to/sender-rules` · VIP, whitelist, blocklist in Rules; rules run before the AI · `triage`.
  6. `how-to/digest-times` · change the digest times and the time zone; quiet hours 22:00–07:00 are fixed (say it: you cannot change them) · `digest-and-notices`.
  7. `how-to/pause` · `/pause` and `/resume` in Telegram; pause a mailbox in Mailboxes; what a paused account (operator) means · `digest-and-notices`, `sync`, `tenancy-and-plans`.
  8. `how-to/mode-and-switches` · move from shadow to assist; each switch; why a category's automatic move can be locked (go/no-go: 98% precision on at least 30 labels) · `actions-and-undo`, `triage`.
  9. `how-to/two-factor` · turn on two-factor sign-in, backup codes, trusted device, what to do when the phone is lost (ask the operator) · `web-panel`.
  10. `how-to/language` · panel language in Settings → Account; Telegram language follows it (check `POLISH_MESSAGES_ON` in the capability page and write only what is true) · `web-panel`, `digest-and-notices`.
- **Decisions:**
  - Each page: goal sentence, "Before you start" (only if needed), numbered steps, "What happens next" (1–3 sentences). At most about 50 lines.
  - Owner-only actions say so ("Only the owner of the organization can …"), from the capability page's owner rules.
  - A CLI command (`bun run …`) appears only as "your operator runs …"; the operator page holds the detail.
- **Test:**
  - T1: `bun run docs:build` passes (links, front matter, public content).
  - T2: `site-map.test.ts` passes with the 10 ids (minus any dropped by P2, named in the final message).
  - T3: each how-to page has `capabilities` with at least one entry (the build check of stage 04 proves it; quote its log line).
- **Done when:** T1–T3 hold; the final message lists each page with the capability rules it uses.
- **Out of scope:** Polish (stage 10); screenshots (stage 11); delete or export (flag `org_delete`, default off at the plan base; if it is on by default at `HEAD`, add `how-to/delete-or-export` with `account-data`).

## Proof

The plan's chain with `NN` = `08`, then `&& bun run docs:stale > /tmp/f112-s08/stale.log 2>&1` before `&& echo PROOF_OK`.
