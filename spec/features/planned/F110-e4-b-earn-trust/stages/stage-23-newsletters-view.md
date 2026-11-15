# F110 stage 23 — Newsletters view

Part of [`../plan.md`](../plan.md). Web stage. Flag `bulk_unsubscribe`. Polish text: review by `claude-opus-5-5`.

## Step 1 — Read route

- **Goal:** the panel lists newsletter senders with a count, the latest date and the unsubscribe method (P6; discovery §3.5).
- **Files:** `GET /api/newsletters/:mailboxId` with `apiDoc` (any member), schema in `packages/core/src/web/newsletters.ts`, from `listNewsletterSenders` (stage 22).
- **Decisions:**
  - Each item: `senderLower`, `fromName`, `count`, `latestAt`, `method: "one_click" | "link" | "none"`, `request: { status, at } | null` (from `unsubscribe_requests`), and `linkUrl` only when `method` is `link`.
  - `linkUrl` = the first `https` URI of `List-Unsubscribe` of the newest mail; any `http:` or other scheme is not offered (`method: "none"`). The URL is shown only in the panel, never logged.
  - Flag off → 404.
- **Test** (`apps/server/test/integration/web-newsletters.test.ts`):
  1. Two senders (one one-click, one link only) → two items with the right `method`; the link item has `linkUrl`, the one-click item has none.
  2. A sender whose only URI is `http://…` → `method: "none"`.
  3. Foreign mailbox → 404; flag off → 404.

## Step 2 — Page part

- **Goal:** a "Newsletters" list in the panel, one tap per sender.
- **Files:** a section of the Rules page or a new page `newsletters.astro` (keep the phone tab bar at ≤ 5; a Rules header tab is fine); page keys en and pl.
- **Decisions:**
  - Row: sender name and address, `count` mails in 30 days, the latest date, and one action:
    - `one_click` (owner): `Unsubscribe` → a confirm dialog "We send one unsubscribe request to this sender. This cannot be undone." → stage 24 route. Until stage 24 lands, the button is hidden (the stage 24 worker shows it).
    - `link`: `Open unsubscribe page` opens `linkUrl` in a new tab with `rel="noopener noreferrer"`; the server does nothing (D17).
    - `none`: text "No unsubscribe link".
  - A row with a request shows its state: `Requested` / `Done` / `Failed — open the page instead` (with the link when one exists).
  - Members see the list without actions.
  - No `is:inline` script, no `on*=` attribute.
- **Test:** e2e: seeded senders → rows with the three method states; the link has `target="_blank"` and `rel` with `noopener`; `expectNoA11yViolations`; `cspErrors` empty.

## Done when

- Proof (`s23`, with the web part) prints `PROOF_OK`.

## Out of scope

The POST (stage 24). Auto-archive or sender rules after unsubscribe (Q12).
