# F150 stage 02 — the docs flag guard lists the real texts

Needs: nothing. May run next to 01 and 03.
Part of [`../plan.md`](../plan.md). Review before the land (plan § Review).

## Background

`apps/docs/src/flagged-text.ts` lists the user-visible strings of every default-off flag. `flagged-text.test.ts` fails a docs site page, a public claim or the changelog page that quotes one, because a reader cannot know if the flag is on for them. A flag with no visible text sits in `NO_VISIBLE_TEXT` with a reason. The test T2 demands text or a reason, never both. Nothing checks that a reason is true. At the plan base all five reasons were doubtful (plan § Facts checked).

## Step 1 — each flag is in the right list

- **Goal:** every default-off flag with text that shows only while the flag is on is in `FLAGGED_PANEL_KEYS` or `FLAGGED_BOT_TEXT`; `NO_VISIBLE_TEXT` keeps only true reasons.
- **Decisions:** D5, P2.
- **Do,** for each of `delegate_button`, `trust_ladder`, `reply_drafts`, `draft_copy_check`, `web_push`:
  1. Find where the flag gates what a user sees: a web component or island that reads `me.features`, a server notice or digest line that the flag adds, a bot text in `packages/core/src/texts` or `digest`.
  2. Text found → add one to three keys or literals that only that flag shows. Prefer a title, a switch label or a button. Panel keys go to `FLAGGED_PANEL_KEYS` (English and Polish follow by key). Bot or digest literals go to `FLAGGED_BOT_TEXT`; a literal holds no quote or backslash and must stand in `packages/core/src/texts` or `digest` (existing T2 cases check it). Remove the reason.
  3. No such text → keep the reason. Rewrite it in words: which file reads the flag and why no user sees text. No ticket code, no stage number, no "comes later".
- **Leads, not verified:** `web_push` → the `push_*` panel keys (`en-phone.ts`); `reply_drafts` → `switch_reply_drafts` and the reply panel keys; `delegate_button` → the `dla_*` keys of the delegate dialog; `trust_ladder` → the report page and onboarding keys that only the flag shows (check which `rep_*` keys show with the flag off: those stay out); `draft_copy_check` → the approval view field `copyCheck` and the line it adds in `packages/core/src/digest/approvals.ts`.
- **Edge:** a key that the panel shows both with the flag on and off is not flagged text: leave it out. A key shared by two flags goes to the flag that gates it.

## Step 2 — the pages pass the stricter scan

- **Goal:** `bun test apps/docs/src/flagged-text.test.ts` passes with the new entries.
- **Decisions:** D6.
- **Do:** run the test. For each page, claim or changelog problem: rewrite the sentence so it describes the step without the flagged string, in the page's language (Polish pages under `content/docs/pl/`). The changelog page comes from `CHANGELOG.md`: change its line only if the problem is there, and keep the release fact. Never change a flag default, drop an entry or narrow the scan. A page whose point needs the string: stop and ask in the final message.
- **Test cases** (in `flagged-text.test.ts`, one `test.each` table, no near copy of an existing case): for each flag moved in step 1, one row with a page sentence that quotes its first entry, expected `flaggedTextProblems(sentence)` to contain `<flag>: <text>`. Fixed sentences, for example `"Open ${en.push_title} in Settings."` → contains `` `web_push: ${en.push_title}` `` (adapt to the keys chosen). Break check: remove the flag's entry, see its row fail, restore.
- **Done when:** the test file passes; `NO_VISIBLE_TEXT` holds no string that matches the plan's `STRING_CODE` (F-number, `PD-` number, "stage(s) N").
- **Out of scope:** other flags; the page scan logic (`flaggedTextProblems`); new docs pages.

## Proof

`bun test apps/docs/src/flagged-text.test.ts`, then `bun run check:job`; copy its last line. The final message lists, per flag: moved (with its keys) or kept (with the reason).
