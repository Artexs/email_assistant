# Pebble redesign of the web panel: analysis of the whole transition (2026-11-23)

Read at commit `cd7c95a39`. Inputs: the handoff `~/.pi/agent/notes/2026-11-23-handoff-pebble-ui-migration-plan.md`, the mockup `design/ui-proposals/proposals/03-pebble/index.html` (untracked), the intake note `notes/2026-11-23-pebble-ui-plan-intake.md`.
This file is the big picture: what the change is, its layers, the measured facts, the decisions, the edge cases, the order. It holds no stage plan. No ticket exists yet. Do not run `limen ticket new` before the owner answers § 9: a ticket in `planned/` with no stages shows as "needs plan" in `scripts/coord-scan.sh`.

## 1. Owner input (word for word, 2026-11-23)

- "I don't know if this will be singleton ticket or this will be one big idea that will be split into several tickets and each of them will have a few slices."
- "my goal is to don't leave their leftovers"
- "we don't need to use feature flags"
- "this is all about updating whole repository on staging and once this will be finished it will be uploaded to the production"
- "validate all the edge cases, features, ideas and so on that are required for changing the UI and once we will have all the product decisions or architectural decisions there then the next step will be to optimize it or make it possible to run parallel"
- Earlier: "ok pebble is right. lets use it."; "plan whole transition".

Consequences: no redesign flag (this replaces question 2 of the intake note); the old look is deleted, not kept beside the new one; production changes in one release; the plan comes after the decisions.

## 2. The idea in one paragraph

The redesign is not a theme change. The mockup draws 12 screens in their best state. The real panel has 16 page islands, about 110 feature components, 17 shadcn primitives, 1,427 text keys in two languages, 37 existing feature flags that hide or show parts, and many states per page (empty, loading, error, read-only role, paused organization, retention-cleared data). About 60 % of what a user can see has no drawing. The work is therefore: (1) finish the design for what the mockup does not show, (2) build a design system the pages share, (3) rebuild each page on it, (4) move everything outside the panel that carries the look (app icon, docs site, screenshots, demo video, docs texts), (5) delete what the old look leaves behind, (6) release once.

## 3. Layers of the change

| Layer | What it holds | Size found |
| --- | --- | --- |
| L0 Design tokens | `apps/web/src/styles/global.css`: colours, radius, shadow, type scale, font, focus ring, category colours | 34 tokens × 2 schemes; hand CSS for the legal pages |
| L1 Primitives | `components/ui/*` (shadcn CLI output): button, card, input, select, textarea, switch, tabs, badge, dialog, sheet, dropdown, table, alert, skeleton, tooltip, toast | 17 files, 1,148 lines |
| L1b Patterns (new) | page head, section card with icon, row list, category pill, avatar, progress ring, steps, filter chips, empty state, stat tile, mode toggle, time chip | none exists today |
| L2 Shell | `layouts/App.astro`, `Public.astro`, `components/shell/*`: sidebar, phone header, bottom tabs, menu sheet, user menu, three banners, terms dialog, "what is new" card, toasts, load and error states | 11 files |
| L3 Pages | activity, approvals, delegates, delegations and open loops, forgot, login, mailboxes, onboarding, operator, report, review, rules, settings, setup, stats; legal pages, 404, offline, `/` redirect | 16 islands, 17 component folders; settings alone has 23 component files |
| L4 Behaviour | approvals focus queue, delegation status columns, onboarding mode cards, sentence rule form, empty states, navigation order | 5 named in the handoff, more found (§ 6) |
| L5 Brand assets | favicon, three PWA icons, manifest colours, `theme-color` meta (today navy `#000832`), docs site (Starlight default colours), login art | navy today, teal in Pebble |
| L6 Texts | `apps/web/src/i18n/texts/en-*.ts` and `pl-*.ts` | 1,427 keys per language |
| L7 Tests | `apps/web/e2e/tests` (37 specs, 131 a11y scans), demo recording spec, docs shots spec, 50 component test files | see § 4 |
| L8 Docs | `docs/capabilities/web-panel.md` (10.7k words), user docs in `apps/docs`, 20 docs shots, demo video and captions, changelog and "what is new" card, ADRs, `docs/code-patterns.md` § web | — |
| L9 Release | integration line, preview for the owner, one release, service worker cache, installed PWA | no staging exists today |

## 4. Facts measured

- **The code is clean for a token change.** Only 3 feature files use a raw palette colour (`PausedBanner`, `AuthErrorBanner`, `TotpQr`). No inline `style=` except the toast. So a token change reaches every page at once.
- **The mockup tokens fail WCAG AA in places** (computed 2026-11-23). Light: teal on the soft teal tint 4.36:1 (soft button, active nav link; need 4.5); category pills urgent 4.30, notification 4.30, unsure 4.16. Dark: white on destructive 2.49 (today's destructive button uses `text-white`). Input borders are 1.29:1 against the card (WCAG 1.4.11 asks 3:1 for a control boundary). The e2e a11y scan (`apps/web/e2e/a11y.ts`, axe WCAG 2.2 AA) would fail. The scan runs in the light scheme only: dark is not checked today.
- **Type scale.** 396 uses of `text-sm` (14 px). Pebble sets 16 px body text and 48 px buttons. Buttons are 36 px today (`h-9`).
- **Radius.** `rounded-md` (48 uses) is `calc(var(--radius) - 2px)`. With `--radius: 22px` every small control gets 20 px. The radius scale needs explicit steps.
- **Tests find elements by text key, not by literal.** 525 of 557 role-name selectors and 228 of 254 text selectors read the `en` text object. A text change does not break them. A structure change does (approvals, delegations, onboarding, rules).
- **No visual test exists** (`toHaveScreenshot`: 0).
- **Data for the mockup.** Exists: review confidence, stats handled share (`m4`), mistakes (`m3`), urgent p90 (`m5`), delegation statuses `drafted, sent, answered, overdue, done, cancelled` (four list filters `open, overdue, answered, closed`, paged), `me.user.displayName`, Undo window 7 days (`UNDO_WINDOW_MS`). Does not exist: a "why I wrote this" text for a draft (the approval view has no reason field), "12 approved this week", "3 min on average", "6.5 hours saved", "mails today" per mailbox, a pause button for a mailbox, open and overdue counts per delegate, a week-by-week series in one call.
- **Environments.** Local dev and the production VPS only. A deploy is a tag on a commit of `origin/master` (`deploy/release.sh`). The word "staging" is in no deploy file or doc. CI runs on `master` and on branches `task/**`. The docs site deploys on each `v*` tag and makes its screenshots in that run.
- **PWA.** `SW_VERSION = "v1"` caches `/offline.html` and `/_astro/*`. The CSP allows `font-src 'self'`.
- **Other tickets.** Active: reply drafts (F115; all stages landed, pilot checks by the owner open) and the demo video and docs shots (F151; stages 05–07 open). Nothing else changes `apps/web` now.

## 5. Decisions

Status: `owner` = needs the owner (§ 9); `default` = taken by the planner, the owner may change it.

### Product

- **P1 No redesign flag; one production release.** owner, decided.
- **P2 What "staging" is.** owner. No staging exists. Proposal: a long-lived branch `task/pebble-ui` (CI runs on `task/**`) is the staging line; a preview of that branch runs on this machine over Tailscale with synthetic data only; `master` and production keep the old look until one merge and one release. Rejected: land on `master` and stop releases (a production fix during the work would ship a half-new panel). Rejected: a staging stack on the VPS (a new environment with its own data and secrets is a separate project).
- **P3 How much the structure may change.** owner. The mockup moves things without saying so: phone tabs (review and stats in, delegations and mailboxes out), the automatic-action switches from Settings to Mailboxes, the mode toggle onto the mailbox card, Approvals as the first page, first-person headings. Proposal: new look and layout; every control stays on its page and keeps its name; the five named behaviour changes are the only exceptions; Approvals becomes the page after sign-in when the approvals page is on.
- **P4 Design completion before the build.** owner. Proposal: one more static mockup pass (same method as the study) for everything not drawn: phone menu, tablet width, queue states, open loops, the rules cards, settings navigation, dialogs, banners, toasts, setup, forgot, legal, 404, offline, operator. The owner approves pictures once; the workers then build to a drawing, not to taste.
- **P5 Safety of the focus queue.** owner. After "Yes, send it" the next draft appears under the same finger. Proposal: a short "Sent to <name>" state with the buttons locked, then the next draft; "Later" skips a draft without a decision; the list of waiting drafts stays reachable on the phone.
- **P6 Brand reach.** owner. Proposal: favicon, app icons, manifest and `theme-color` change from navy to teal; the docs site takes the teal accent, the mark and the font; the name stays; the report mail stays plain. The Telegram bot picture is an owner step.
- **P7 Timing with the reply-draft pilot (F115).** owner. The queue changes how the owner approves drafts during the pilot. Proposal: release after the 20-draft check is recorded.
- **P8 Mockup items with no data.** default: cut all of § 4 "does not exist". The "why" box shows facts that exist (kind, sender line, due date, instruction). Stats: the ring and three facts on top, today's table below; no bar chart. A new metric is a later ticket by the metric rule.
- **P9 Voice.** default: friendly headings and buttons, no first-person past tense (Polish needs a gender), no name inflection in a greeting. Each promise in the UI ("Undo for 7 days", "nothing is sent without your tap") must be true and is checked against the legal claims ledger. "It takes about two minutes" is cut.
- **P10 Font, dark mode, name.** default: Nunito self-hosted (OFL), Latin and Latin Extended; system dark mode only; "Email Assistant" stays.
- **P11 Operator console.** default: new theme, tables stay dense (internal tool).
- **P12 The mockup in the repo.** owner (the repo is public). Proposal: commit the Pebble mockup for the build, delete it in the last ticket; an ADR and the code are the truth after that. The other seven directions are never committed.

### Architecture

- **D1 Invariants.** No DB migration, no API change, no URL or anchor change (Telegram and docs links point at panel URLs), no `bun.lock` change unless a decision names it. Then a rollback is an image rollback.
- **D2 Tokens.** Pebble tokens adjusted until every text pair passes AA; new tokens `primary-soft`, `destructive-foreground`, a control border separate from the divider border, seven category colours, an explicit radius scale and type scale. One ADR records them.
- **D3 Primitives.** The rule "shadcn components come from the CLI, never by hand" stays for adding a component. The ADR allows edits of variants and sizes in `components/ui/`. Pattern components (L1b) are app components in their own folder.
- **D4 Registries.** Category to icon and colour is one typed record with a test against the enum; delegation status to column is one too. Emoji leave the panel texts.
- **D5 Guards against leftovers.** A scan test fails on a raw palette class or a hex colour outside the token file; a test fails on a text key no source file reads; the old tokens (`chart-*`, unused `sidebar-*`) go.
- **D6 Proof instrument.** One Playwright run renders every route × phone and desktop × light and dark × English and Polish × data state (flags off, pilot flags on, empty, error) into a contact sheet. The a11y scan also runs in the dark scheme. This sheet is what the owner reviews on staging, and what a vision review compares with the mockup.
- **D7 Staging data.** The synthetic demo-week export of F151 plus a stress set (long Polish strings, 100 rows, long addresses).
- **D8 Docs.** Each page ticket updates its part of `docs/capabilities/web-panel.md` and the user page (PD-009, PD-100). Docs shots and the demo video are made again at the end.

## 6. Edge cases by area

**Design system.** AA failures above. Shadow-only cards vanish in forced-colors mode. Reduced motion. 320 px width and 200 % zoom without sideways scroll. Polish text is about 20 % longer (five phone tabs: "Zatwierdzenia"). Safe-area inset under the bottom tabs in the installed app. `100vh` on a phone. Tablet widths 761–1023 px are not drawn. Font: weights 500–800, tabular numbers, layout shift while it loads, offline page, cache. The QR code stays black on white.

**Flags.** The redesign has no flag, but 37 product flags hide parts. Each page must look right with its flags off and on: 4 or 7 navigation items, Delegations or Open loops, settings cards that come and go. The mockup shows only "all on".

**Shell.** Each page gets a head (title, one line, action): the shell loses its own heading. Phone header: where the items go that do not fit in five tabs (rules, operator, onboarding, help, log out). Banners (login error, paused organization, trial), the terms dialog and toasts inside the floating layout. Read-only role and paused plan: every action needs a disabled state. Loading skeletons must match the new layouts.

**Approvals queue.** The risk page: it sends mail to people. Draft kinds (delegation, reply, follow-up). Eight detail states and eight end reasons reached by a link from Telegram (`?id=`): a decided, expired or superseded draft must show as a closed card. Draft not ready yet. Redraft with an instruction and its limit. Reply-all list. Change of delegate in the edit. Held sends (approved, not sent yet) are not part of the queue. A draft decided elsewhere at the same time (version conflict). Expiry while the card is open. More drafts than the list limit. Reject reasons after "No". Long drafts on a phone: the decision bar is fixed. Focus and screen-reader announcement when the card changes. Today's text shows a config key ("held by SEND_SCOPE").

**Review.** Confidence shows only with the "why lines" flag. Category picker for a correction. Done state.

**Activity.** Six filters plus a mailbox selector. Day groups in the organization time zone (DST). Up to four actions on one row (undo, correct category, delegate, draft a reply) on a phone. Three different empty states. Undo after the window.

**Delegations and open loops.** Four columns do not fit a phone: sections or tabs there. Every status needs a column (`drafted` and `sent` both sit in the `open` filter; `done` and `cancelled` are closed). Paging per column. Row actions: remind (with a limit), done, cancel. With the open-loops flag the page is another board with its own tabs.

**Rules.** A sentence form breaks in translation unless each language orders its own slots; each slot needs a label for a screen reader; error text placement. Three more cards with no drawing: newsletters, suggestions, urgency.

**Onboarding.** The mode cards must not become a second way to set the mode with weaker checks: they open today's mode dialog.

**Mailboxes.** Statuses beyond "connected" and "login failed": refused host, OAuth revoked, never synced. OAuth banners. Scope badges that show server settings. Connect, password and remove dialogs.

**Settings.** 23 cards on one page become very long at Pebble sizes: it needs in-page navigation. Anchors and `data-card` names are used by tests and docs links. Mailbox, organization and user settings are mixed.

**Stats and report.** Weeks with no data. Cost numbers. The report's "Turn on" must use today's gate dialogs.

**Sign-in pages.** Password, SSO, authenticator code, backup code, rate limit, setup from an invite, forgot. Pages before sign-in are static English first, then the browser language. The login art makes product promises.

**Outside the panel.** An installed app keeps the old icon for days (Android) or until it is added again (iOS). The docs site and the demo video show the old look until the release. User docs name buttons that change.

## 7. Dependencies and order

```
decisions (§ 9) ─► design completion (mockups for the missing 60 %) ─► owner approves pictures
        │
        └─► staging line + preview + contact-sheet instrument
                    │
                    ▼
        design system (tokens, font, primitives, patterns, guards) ─► shell + brand assets + sign-in pages
                    │                                                        │
                    └────────────────────────┬───────────────────────────────┘
                                             ▼
          page groups, in parallel:  daily work (approvals, activity, review)
                                     people and rules (delegations, open loops, delegates, rules)
                                     setup and control (onboarding, mailboxes, settings, stats, report, operator)
                                             │
                                             ▼
          outside the panel (docs site, user docs, shots, demo video) ─► cleanup of leftovers ─► merge, release
```

Shared files that make page groups collide: the text group files, `nav-items.ts`, `docs/capabilities/web-panel.md`. The rule "merge and re-prove" covers them.

## 8. Ticket shape (proposal)

One programme, seven tickets, each with a few slices: (1) design completion and decisions record (ADR); (2) staging line, preview and contact sheet; (3) design system; (4) shell, brand, sign-in and static pages; (5) three page-group tickets that run in parallel; (6) docs site, user docs, shots and video; (7) cleanup and release. The design-completion ticket and the staging ticket can start together.

## 9. Open questions for the owner

P2 staging, P3 structure, P4 design completion, P5 queue safety, P6 brand reach, P7 pilot timing, P12 mockup in the public repo. Each has a proposal in § 5.

## 10. Not verified yet

- That Limen jobs can spawn from and land on a branch other than `master` in a second checkout, and that `bun run check:job` and `scripts/land-check.sh` work there.
- A preview server for the branch with the demo-week data (which script starts it, which port).
- Nunito: licence text, file size with Latin Extended, tabular numbers.
- Whether `next-themes` is used by anything but the toast.
- The legal claims ledger entries for the UI promises.
- The exact count of user docs pages that name panel buttons.
- The open-loops board states and the three undrawn rules cards (read before the design-completion pass).

## 11. Owner answers and what exists now (2026-11-23, later the same day)

- Owner: "the staging is all about the [dev] environment on this machine. That should be totally fine and enough." So P2 is: stages land on `master`; no branch; one production release at the end.
- Owner: "For the rest of design just follow the pattern from this template and apply it on … all pages." So P4 is: no extra mockup pass.
- P3, P5, P6, P7 were taken as defaults. P12 (the mockup commit into the public repo) still needs the owner's yes: it is owner step O1 of the design system ticket.
- Written: the programme page `docs/product/pebble-ui/README.md` (decisions PB-1…13, DB-1…11, the pattern names, the proof tools, the ticket order); seven tickets `spec/features/planned/F166-…` to `F172-…`; the full plan of the design system ticket (F166: `plan.md`, `interfaces.md`, seven stage files).
- Next: the cold review of the F166 plan (a scout job), then planner jobs for F167–F170 (they read `interfaces.md` of F166), then F171 and F172.

## 12. Reshaped for width (2026-11-23, owner: "any possibility to run more work in parallel")

- Measured: the full e2e suite takes about 19 min in CI; a Playwright run takes about 2.1 GB; this machine has 16 cores and about 15 GB free, so about five UI jobs fit at once. This is the real cap on width.
- The design system ticket (F166) now has 10 stages in 3 waves (depth 3, was 5): the pattern page finds its sections by itself, the patterns are split in two, parallel stages share no file.
- The page head contract of the shell moved into F166 (stage 09). The shell ticket (F167) no longer blocks the page tickets: F167–F170 build next to each other after F166 stages 03, 06, 09, 10.
- The owner step O1 (mockup commit) now gates only stages 04, 05, 06, 10; waves 1 and 2 need no owner.
- The owner's first look moved to the landing of F166 (pattern page): a correction there is cheap, before four tickets build on it.
- Planner rules for width: `docs/product/pebble-ui/README.md` § Rules for width.
- Not taken: stub patterns for an earlier page start; a split of the approvals decision flow.
