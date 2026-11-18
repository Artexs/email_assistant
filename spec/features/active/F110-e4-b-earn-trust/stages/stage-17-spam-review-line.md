# F110 stage 17 — Spam review line in the digest

Part of [`../plan.md`](../plan.md). Flag `spam_review_line`.

## Step 1 — Count and link

- **Goal:** the digest names how many mails went to spam since the last digest and links to the filtered Activity list, to catch false positives (ES 6; E4 cross-check "Spam review").
- **Files:** the digest view builder (`channels/digest-job.ts` or its read model) and `renderDigest` footer; texts en and pl.
- **Decisions:**
  - Count = mails of the member's org whose `move` to `ai_spam` became `applied` in the digest window (after the member's last digest slot, at most 24 h back). In shadow mode: `logged` moves to `ai_spam` in the window, with the text "would have gone to spam".
  - Mail from the spam folder that stayed there is not counted (it was spam before the system).
  - The line: `🗑 <n> went to spam · review: <url>` with `<WEB_BASE_URL>/activity?category=spam` (read the Activity filter param at `HEAD`; if the page has no URL filter, add one in `ActivityPage.tsx` that sets the existing category filter). Without `WEB_BASE_URL`: `🗑 <n> went to spam · check them in the panel`.
  - No line when `n` = 0. The line is a footer line: it counts against `DIGEST_MAX_LINES` like the others and is dropped before item lines when the digest is full (read the footer order rule; put it after the shadow line).
  - D15: a count and a fixed URL only.
- **Test:**
  1. Render: `n` = 3, URL set → the line with the URL; URL unset → the panel text.
  2. `n` = 0 → no line.
  3. Integration: 2 applied spam moves and 1 logged move in the window, 1 applied before the window → `n` = 2 in `assist`.
  4. Shadow mailbox with 2 logged spam moves → "would have gone to spam", `n` = 2.
  5. Flag off → no line.
  6. pl text.
- **Check:** `bun test packages/core/src/digest/digest.test.ts`

## Done when

- Proof (`s17`) prints `PROOF_OK` (add the web part only if `ActivityPage.tsx` changed).

## Out of scope

A spam page of its own. Undo from the digest line (the Activity list has Undo).
