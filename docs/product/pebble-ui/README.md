# Pebble redesign of the web panel: programme page

> Written 2026-11-23. The epic page for seven tickets (F166–F172). Every planner and worker of these tickets reads this page. It holds the decisions that all of them share; a ticket's own `plan.md` holds only what is local to it. Analysis behind it: `notes/2026-11-23-pebble-ui-transition-analysis.md`.

## What changes

The web panel (`apps/web`) moves from the stock shadcn look to the Pebble design: one teal brand colour, large radius, soft shadows, a rounded font, 16 px text, 48 px buttons, a floating sidebar on a desktop and a bottom tab bar on a phone. The drawing was `design/ui-proposals/proposals/03-pebble/index.html` (12 screens, phone and desktop, light and dark). It was a pattern, not a full specification: it showed about 40 % of what a user can see. Every other page, state and dialog follows the same patterns (owner, 2026-11-23). The drawing was the source; it left the repository with the last ticket and is in Git history at `94092626b` (`design/ui-proposals/proposals/03-pebble/`). Now the design system ADR (`docs/decisions/0037-panel-design-system.md`), the pattern page (`/dev/patterns`) and the code are the reference.

## Owner's words (2026-11-23)

- "ok pebble is right. lets use it."
- "my goal is to don't leave their leftovers"
- "we don't need to use feature flags"
- "this is all about updating whole repository on staging and once this will be finished it will be uploaded to the production"
- "the staging is all about the [dev] environment on this machine. That should be totally fine and enough."
- "For the rest of design just follow the pattern from this template and apply it on … all pages."

## Product decisions

`owner` = the owner said it. `default` = taken for the owner; the coordinator copies it to `docs/owner-decisions.md`.

| Id | Decision | Source |
| --- | --- | --- |
| PB-1 | No feature flag for the redesign. The old look is replaced, never kept beside the new one. The 37 product flags of `packages/core/src/features.ts` stay as they are. | owner |
| PB-2 | Staging is `master` on the dev machine. Stages land on `master`. Production changes in one release, in the last ticket (F172). Until then the coordinator makes no release; a production fix that cannot wait is the one exception, and the owner hears of it first. | owner; hold: default |
| PB-3 | No extra mockup pass. A page or state with no drawing uses the patterns of § Patterns. | owner |
| PB-4 | Every control stays on its page and keeps its navigation name. The mockup's silent moves are not taken: the phone tabs keep today's order rule, the automatic-action switches stay in Settings, the mode is set where it is set today. | default |
| PB-5 | Five behaviour changes are in scope: the approvals focus queue, the delegation status columns, the onboarding mode cards, the sentence rule form, the new empty states. Each keeps today's API calls, checks and dialogs; none adds a second way to do a thing. | owner (handoff) |
| PB-6 | Queue safety: after an approve, the card shows a "sent to" state with locked buttons before the next draft comes. A "Later" button skips a draft with no decision. On a phone the list of waiting drafts stays reachable. | default |
| PB-7 | Mockup items with no data today are cut: "12 approved this week", "3 min on average", "about two minutes", "6.5 hours", "mails today", the pause button on every mailbox card of the mockup (today's Pause and Resume stay), the counts on delegate cards, the weekly bar chart. The "why" box shows only facts the API gives. A new metric is a later ticket by the metric rule. | default |
| PB-8 | Voice: friendly headings and buttons ("Yes, send it", "Was I right?"). No first-person past tense (Polish needs a gender for it). No inflected name in a greeting. A promise in the UI must be true today and agree with the legal claims ledger. | default |
| PB-9 | Brand: the name "Email Assistant" stays. Favicon, app icons, manifest colours and `theme-color` move from navy to teal. The docs site takes the teal accent, the mark and the font. The report mail does not change. | default |
| PB-10 | Font: Nunito, self-hosted, Latin and Latin Extended. Dark mode follows the system setting; no manual switch. | default |
| PB-11 | The operator console gets the theme and keeps dense tables. | default |
| PB-12 | The owner looks twice: at the pattern page and the contact sheet when F166 lands (a look, not a stop: a correction of a pattern there reaches every page), and at the full contact sheet before the release in F172 (a stop: the release waits for "go"). The release also waits for the 20-draft check of the reply-draft pilot. | default |
| PB-13 | The mockup is committed for the build (done 2026-11-23) and deleted in F172 (done 2026-11-25). Now the design system ADR, the pattern page and the code are the truth. | owner ("it will end up there anyway after implementation") |

## Design decisions

| Id | Decision |
| --- | --- |
| DB-1 | Invariants for every ticket: no DB migration, no API or schema change in `packages/core/src/web`, no URL, query or anchor change, no `bun.lock` change. A stage that needs to break one stops and asks. |
| DB-2 | All colour, radius, shadow and font values live in `apps/web/src/styles/global.css` as tokens. A component uses token classes only (`bg-primary`, `text-muted-foreground`); no palette class (`bg-amber-50`), no hex value, no inline `style`. A scan test enforces it. |
| DB-3 | Token values are the mockup's values, changed where WCAG 2.2 AA fails. The fixed values are in `spec/features/*/F166-*/interfaces.md` and in the design system ADR. Every text pair is at least 4.5:1; a control boundary is at least 3:1. |
| DB-4 | The e2e a11y scan runs in the light scheme on both projects and in the dark scheme on the `desktop` project (the CI job has a 20-minute limit). |
| DB-5 | `components/ui/` holds shadcn CLI output. A new primitive still comes from the CLI. Editing variants, sizes and classes of an existing file is allowed and is how the theme reaches the primitives. Pattern components are app code in `components/patterns/`. |
| DB-6 | Sizes: text 13, 14, 16, 18, 20, 30 px; a control is 48 px high (44 px compact, 36 px only in dense tables); radius 10, 16, 22, 28 px and full. One breakpoint pair: phone layout below `lg` (1024 px), desktop from `lg`; a page with two columns uses one column below `lg`. |
| DB-7 | Layout rules: no sideways scroll at 320 px; the bottom tab bar respects the safe-area inset; a card has a border in forced-colors mode; motion stops under `prefers-reduced-motion`. |
| DB-8 | A category has one look (icon and colour token) in one typed record with a test against the category enum. Emoji leave the panel texts. A delegation status maps to its column the same way. |
| DB-9 | The page head (title, one lead line, one action) is rendered by the shell from props that the island passes. Islands do not render their own `h1`. |
| DB-10 | Texts: every string is a key in `en` and `pl`. A key that no source file reads is deleted in the same stage; a test fails on an unused key. |
| DB-11 | Each stage updates its part of `docs/capabilities/web-panel.md` and the user docs page of a page it changes (`docs/code-patterns.md` § Capability map). |

## Patterns

Names are fixed here; F166 builds them and defines their props in its `interfaces.md`. F166 also builds the shell contract: an island passes `lead` and `action` to `AppShell`, and the shell renders the one `PageHead`.

| Pattern | Use it for |
| --- | --- |
| `PageHead` | The title, lead line and one action of a page (through the shell). |
| `SectionCard` | A titled card with an icon tile; one topic of a settings-like page; `danger` tone for destructive topics. |
| `RowList`, `Row` | Lines inside a card: label, hint, one control at the end. |
| `CategoryPill` | A mail category. Other small labels use the `Badge` primitive. |
| `InitialsAvatar` | A person or mailbox. |
| `ProgressRing`, `StepDots` | Progress of a count ("2 of 10"). |
| `FilterChips` | A row of filters that toggle. |
| `EmptyState` | Nothing to show: icon, one sentence, the next step as a button. |
| `StatTile` | One number with its label. |
| `FactBox` | The warm box for "why" facts and for calm notes. |
| `StickyActions` | The decision bar fixed above the tab bar on a phone. |

## Proof

- **Contact sheet** (`bun run ui:sheet`, built in F166): every route × phone and desktop × light and dark × English and Polish × organization state, as PNG files with one HTML index, in `~/.local/share/email-assistant/ui-sheet/<job>/` (outside the worktree; the coordinator deletes a job's folder after its land). A stage that changes a page runs it for that page and reads its own pictures next to the mockup shots before it says done. The owner reads the full sheet at the two looks of PB-12.
- **Pattern page** (`/dev/patterns`): a page of the dev build (`bun run web:build:dev`) that shows every primitive and pattern in each variant to a signed-in user. It is not in the production build.
- The existing e2e spec of a page and its a11y scan pass (DB-4).

## Tickets and order

```
F166 design system                      ┌► F167 shell, brand, sign-in pages          ─┐
  wave 1: records ∥ tools               ├► F168 approvals, activity, review          ─┤
  wave 2: tokens ∥ pattern page    ─────┼► F169 delegations, open loops, rules       ─┼► F171 shots, video ─► F172 cleanup, release
  wave 3: primitives ∥ patterns         ├► F170 onboarding, mailboxes, settings, …   ─┤
          ∥ page head contract ∥ guards └► F171 docs site theme (needs tokens only)  ─┘
  wave 4: dark scan for every page
```

F167, F168, F169 and F170 run next to each other. They wait for four stages of F166 only: 03 (tokens), 06 and 10 (patterns), 04 (Button variants soft and destructive-soft, 48 px fields), 08 (the pattern page and its proof command), 09 (the page head contract). Their planner jobs start together, when the review fixes of the F166 plan are committed. The demo video and docs shots ticket (F151) finishes its tool stages now; its takes are made again in F171.

## Follow-ups

Proposals from the visual review before the release. Each one is a follow-up ticket for the owner to choose; none blocks the release.

- **Delegation card buttons on a desktop** (route `delegations`): a card column is about 245 px wide at 1280 px, so "Remind now", "Mark as done" and "Cancel delegation" stack one per line and a card is about twice as high as the drawn one. Proposal: "Remind now" stays a button; "Mark as done" and "Cancel delegation" move into a menu on the card. It moves two controls into a menu (decision PB-4 keeps each control on its page), so it is a change of its own and not a class fix.
- **Stats table on a phone** (route `stats`): proposal: a phone shows one finished week at a time, with a week picker over a two-column list of metrics, in place of the eight-column table that scrolls inside its card.

## Rules for width

For the planner of each ticket F167–F171 (owner, 2026-11-23: as much work in parallel as the work permits).

1. **One stage owns its files.** A stage is one page, or one section of a large page: its island, its component folder, its e2e spec, its part of `docs/capabilities/web-panel.md` and its user docs page. Two stages that may run together own no common file. Write `May run next to …` on every stage where that holds.
2. **A frame stage first, then width.** A page with many parts (Settings, Approvals, Rules) gets one first stage that fixes its frame (layout, in-page navigation, shared hooks, the `lead` and `action` of the page head). Its sections then run next to each other.
3. **Shared files have one owner.** `global.css`, `components/ui/`, `components/patterns/` belong to F166; `components/shell/`, `nav-items.ts` and the layouts belong to F167. A page stage that needs a change there stops and asks: it is a contract change.
4. **Text keys.** A stage adds a key next to the keys of its page, never at the end of a group file (two additions at one place conflict). A page that gets more than 20 new keys and has no group file of its own gets one, named for the page, in its frame stage.
5. **Needs lines name stages**, for example `Needs F166 stage 09: AppShell lead and action`. Never "F166 landed".
6. **Proof of a page stage:** `bun run check:job`, `bun run web:build:dev`, then only the e2e specs of its page and `patterns.spec.ts`. The full e2e suite (about 19 minutes, about 2.1 GB of memory) runs in CI on `master`; only a stage that changes every page runs it itself.
7. **Do not split a `[risky]` stage for speed.** The approvals queue decision flow is one careful stage with an Opus review.
8. **Know the cap.** About five Playwright runs fit this machine's free memory at once (16 cores, about 15 GB free); the Limen start queue holds the rest. More than about six UI stages ready at one time gains nothing, so do not cut stages smaller for width alone.

A land conflict is solved by "merge `master`, prove again".
