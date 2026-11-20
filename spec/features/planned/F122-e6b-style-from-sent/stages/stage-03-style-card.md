# F122 stage 03 — Style card button

Part of [`../plan.md`](../plan.md). Needs stage 02: route `POST /api/mailboxes/:id/profile/style-suggestion` and `styleSuggestionAnswerSchema`.

The owner taps "Suggest my style from my sent mail" on the style card, reads the suggestion, and puts it into the writing-style field. Nothing is saved until Save.

## Step 1 — Card logic and texts

- **Goal:** a pure helper in `apps/web/src/lib/` (next to `reply-style.ts`) that gives the state of the button and the text of each answer, a client call in the API layer, and the texts `rs_suggest_*` (en, pl).
- **Decisions:** D12, D8. The button shows while `/api/me` `features` holds `reply_drafts` and `style_from_sent`. It is active for an owner while the settings answer of the mailbox says sent tracking is on; else it is off with the line "Turn on 'Track my sent mail' to use this." A member sees nothing of it. An OAuth mailbox shows the reason line of the card, as the switch does.
- **Texts (en; pl with the same meaning, tested in a fixed Polish table):**
  - button: "Suggest my style from my sent mail"
  - note under it: "Reads up to 100 of your sent mails of the last 14 days, once. Only the text you save is kept."
  - result head: "Based on {count} sent mails" (plural forms in pl with `tp()`)
  - actions: "Use this text", "Discard"
  - `too_few`: "Not enough sent mail yet ({count} of 5). Try again after you send more mail."
  - `sent_off`: the off line above; `suggest_limit`: "You can ask for 3 suggestions a day. Try again later."; `suggest_busy`: "A suggestion is being written. Wait a moment."
  - failures: `llm_off` and `llm_cap` use the preview texts; others: "No suggestion this time. Try again later."
- **Test (unit):**
  1. State table (`test.each`): owner + both flags + tracking on → active; tracking off → off with the line; member → hidden; one flag missing → hidden.
  2. Each answer kind of `interfaces.md` → its text key (one row per kind).
  3. Polish table: `rs_suggest_button` = "Zaproponuj mój styl na podstawie wysłanych wiadomości" (the worker may choose better Polish; the table then fixes the chosen text) and the plural of the result head for 1, 2, 5, 22.

## Step 2 — The card

- **Goal:** the button, the note, the result box and the two actions in `ReplyStyleCard.tsx` (or a new child component if the card passes about 400 lines; it has 385 now).
- **Decisions:** the result shows as plain text (never markup). "Use this text" replaces the writing-style field and focuses it; the old field value is not kept. "Discard" closes the box. The button is off while a call runs. No auto-save; the existing Save writes the field.
- **Test:**
  1. Component test: a fake answer `{ text: "Krótko.", count: 7 }` → the box shows "Krótko." and the count line; "Use this text" puts "Krótko." into the field; nothing is sent to `PUT /profile` until Save.
  2. Component test: a 409 `too_few` with `count: 3` → the note line, no box.
  3. E2E (`apps/web/e2e/tests/reply-style.spec.ts`, the route answer faked as the preview test does): owner taps, uses the text, saves; a reload shows the saved writing style. axe on the card with the box open: no violation.
- **Check:** the touched unit tests, `bun run test:e2e -- reply-style`, then the Proof.
- **Done when:** the tests pass; the Proof line is PASS.
- **Out of scope:** server changes; the guided form; the organization signature card (stage 04).
