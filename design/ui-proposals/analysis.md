# Web panel: why it looks unfinished, and eight design directions

Date: 2026-11-22. Panel at commit `cd7c95a39`. Screenshots of today's panel: `current/` (method and limits in `current/README.md`).
Chosen direction (owner, 2026-11-23): Pebble, `proposals/03-pebble/index.html`. The other seven directions and the screenshots of the old panel are not in the repository.

## Why the current panel looks unfinished

The panel works. It looks like a prototype because it uses the default theme and default layouts with no design decisions on top.

1. **No identity.** `apps/web/src/styles/global.css` holds the stock shadcn "neutral" tokens: pure grey, black primary button, white background, `--radius: 0.625rem`. There is no brand color, no logo mark, and no type choice. "Email Assistant" is plain bold text in the corner.
2. **No type hierarchy.** Titles, metadata and body text are 14–16 px with nearly the same weight. On Approvals, the recipient line, the badge, "From:", the subject and the state all look equally important, so nothing leads the eye.
3. **Everything is a bordered card.** Approvals stacks five tall cards with five lines each. Review stacks ten identical cards, each with the same label "Not right? Choose the true category". Repetition without hierarchy reads as raw output.
4. **Layout wastes the screen.** Content stops at about 770 px on a 1280 px screen and is left-aligned. The right third stays empty. On Approvals the detail pane has no frame, and the action buttons sit far below the list.
5. **Data is shown, not explained.** Stats is a 14 × 8 table that is mostly dashes. There is no headline number, no trend and no chart. The Report repeats "Mails checked: 200 · Would be moved: 40" in three cards.
6. **Internal words leak to the user.** "Sending is held by SEND_SCOPE on the server" shows a config key. Emoji (✅ ℹ️ 🔔) carry the category meaning and are the only color on most pages.
7. **Empty and error states are bare.** One grey line plus a button, with no icon and no next step ("No mail in this range. Connect a mailbox first.").
8. **Mobile is the desktop at a smaller size.** The bottom tab bar is good, but list cards keep desktop density and long titles wrap to three lines. Approve or Reject needs a tap into the detail first.
9. **Dark mode is an inversion.** Cards and background differ only by a thin border, so surfaces do not separate.

What is already good and must stay: one island per page, i18n keys, the shadcn component set, the bottom tab bar on the phone, visible focus, and the honest product copy ("The system sends it after your approval").

## The eight directions

All eight use the same invented data (`proposals/_shared/data.js`), so you compare design, not content. Each one maps to the existing shadcn token names (`--background`, `--primary`, `--radius`, `--sidebar`…), so a build is mainly a theme change plus layout work on the pages, not a rewrite.

| # | Name | Idea in one line | Navigation | Feel | Screens shown | New dependency |
|---|------|------------------|------------|------|---------------|----------------|
| 01 | Ledger | Drafts read like letters; serif headings, hairlines, warm paper | Sidebar | Calm, editorial, trustworthy | All 7 | None |
| 02 | Cockpit | Clear the queue fast: three panes, key hints, command bar | Icon rail | Dense, pro tool | Approvals, Activity, Stats | shadcn Command (cmdk) |
| 03 | Pebble | One draft at a time: yes, change, no, next | Floating sidebar | Soft, friendly, big targets | All 12 pages | None |
| 04 | Today | Home is a morning briefing in plain sentences | Top bar | Assistant-first, narrative | Home, Approvals, Activity | None (one new page) |
| 05 | Mailroom | Looks like a mail client: category folders, list, reading pane | Folder column | Familiar, list-first | Approvals, Review, Activity | None |
| 06 | Signal | Dark first, lime accent, big numbers, square corners | Top bar | Bold, confident | Sign in, Approvals, Stats | None |
| 07 | Concierge | The panel talks like Telegram: cards and buttons in a feed | Conversation list | Conversational | Approvals, Activity | None |
| 08 | Aurora | Soft gradient glow behind frosted panels | Floating sidebar | Modern SaaS | All 12 pages | None |

Every direction shows Approvals on desktop and phone, in light and dark mode. On the phone, each design puts Approve, Edit and Reject on the list item itself (44 px or larger), so a manager who comes from a Telegram link can decide without opening a detail page.

## Full drafts: Pebble and Aurora (2026-11-23)

The owner chose two directions for a full draft. Both now show all 12 pages: sign in, onboarding, approvals, approvals empty state, review, report, activity, delegations (with delegates), rules, mailboxes, settings and stats. Each page exists for desktop and phone, in light and dark mode (48 screenshots per direction). The page contents follow today's panel and its English texts. Nothing is a new feature, with one exception: Pebble shows delegations as status columns (overdue, waiting for approval, sent, answered), while today's panel shows one list with filters.

## Things to decide after you pick

- **One direction, or a mix.** The ideas combine well. For example: Ledger's look + Pebble's one-at-a-time approvals on the phone + Today's home page. A mix costs about the same to build as one direction.
- **Product name and mark.** All mockups say "Email Assistant" with a placeholder mark. The name is your call.
- **Concierge and Today change the information structure** (a new home page, or a feed). The others keep today's pages and change how they look. A look-only change is a smaller and safer first ticket.
- **Cockpit needs one new dependency** (the shadcn Command menu, based on cmdk) for its search bar.

## Checks done and not done

- Done: every page rendered in headless Chromium at 1280 × 800 (desktop) and 412 × 915 (phone), light and dark; I looked at each screenshot.
- Not done: no automated contrast or a11y scan of the mockups. Colors were chosen for AA contrast, but a build must still pass `apps/web/e2e/a11y.ts`.
- Not done: no Polish copy. Polish text is about 20 % longer; the build ticket must check the tab bars and buttons with `pl`.

## How to view

- Each design is a live HTML page (`proposals/NN-name/index.html`): it has a small bar at the bottom to switch screens and light or dark mode. Only the chosen direction, Pebble (`proposals/03-pebble/`), is in the repository.
- To refresh the screenshots after a change: `bun design/ui-proposals/tools/shoot.ts [NN-name]`, then `python3 design/ui-proposals/tools/build-gallery.py` (from the repo root).
