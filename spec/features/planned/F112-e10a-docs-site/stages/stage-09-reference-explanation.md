# F112 stage 09 — Reference and explanation (en)

Part of [`../plan.md`](../plan.md). Read P2, P3, D8 and stage 07 § "Shared rules for content stages". Needs stage 07 (may run next to stage 08; both add ids to `site-map.test.ts`: the second to land merges the list).

Two steps. Markdown about 400 lines, one test.

## Step 1 — Reference

- **Goal:** the facts a user looks up, in tables, true to the code.
- **Files:** `apps/docs/src/content/docs/reference/*.mdx`, `apps/docs/src/reference.test.ts` (new), `site-map.test.ts`.
- **Pages:**
  1. `reference/categories` · each triage category, its meaning for you, what assist mode may do with it, the `unsure` rule · `triage`, `actions-and-undo`.
  2. `reference/telegram` · every user command (from `BOT_COMMANDS`) with one line each, the buttons of the digest and the notices with their meaning, quiet hours, the message kinds · `digest-and-notices`, `drafts-and-send`, `delegation`.
  3. `reference/settings` · each panel setting (mode, switches, category policy, sync folders, digest times, time zone, signature, account), who may change it, its default · `actions-and-undo`, `web-panel`, `sync`.
  4. `reference/limits` · the numbers a user meets: digest at most 15 lines, at most 3 messages per tick, a notice expires after 24 h, an approval expiry, mail older than 7 days not acted on, the go/no-go bar, session 30 days, lockout 10 tries in 15 min. Each row names its capability page. Only numbers that a capability page states.
- **Decisions:**
  - No API page (P3) and no autonomy-evidence page (F110); no operator command.
  - Commands behind a default-off flag (for example `/review`) are left out (P2).
- **Test** (`reference.test.ts`, reads the `.mdx` source as text; a test may import server code, `docs/code-patterns.md` § borders):
  - T1: every command of `BOT_COMMANDS` (`apps/server/src/modules/channels/telegram/polling.ts`) that has no default-off flag appears on `reference/telegram` as `` `/name` ``; every `` `/name` `` in that page is in `BOT_COMMANDS`.
  - T2: every entry of `categories` (`packages/core/src/triage/categories.ts`, 7 at the plan base) appears as a row on `reference/categories`, and no other.
  - T3: `bun run docs:build` passes.
- **Done when:** T1–T3 hold.

## Step 2 — Explanation

- **Goal:** why the product behaves as it does, in prose.
- **Files:** `apps/docs/src/content/docs/explanation/*.mdx`, `site-map.test.ts`.
- **Pages:**
  1. `explanation/how-a-mail-is-sorted` · rules before the AI; the classifier; low confidence gives `unsure`; whitelisted mail is never spam; LLM text never picks a recipient or a folder · `triage`.
  2. `explanation/never-sends-alone` · every send needs your tap on the exact text; drafts, approvals, expiry; what "sent" means · `drafts-and-send`.
  3. `explanation/shadow-and-assist` · the two modes; the switches; the go/no-go bar per category and why automatic moves are earned; Undo for each change · `actions-and-undo`, `triage`, `measurement`.
- **Decisions:** each page 40–80 lines; links to the reference and how-to pages; no claim about data location, training or providers (F121 security page).
- **Test:**
  - T4: `bun run docs:build` passes; `site-map.test.ts` has the 4 reference and 3 explanation ids.
- **Done when:** T4 holds; the final message lists each claim with its capability rule.

## Proof

The plan's chain with `NN` = `09`, then `&& bun test apps/docs/src/reference.test.ts > /tmp/f112-s09/reference.log 2>&1` before `&& echo PROOF_OK`.
