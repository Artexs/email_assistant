# Pebble redesign of the web panel: programme page

> Written 2026-11-23. The epic page for seven tickets (F166–F172). Every planner and worker of these tickets reads this page. It holds the decisions that all of them share; a ticket's own `plan.md` holds only what is local to it. Analysis behind it: `notes/2026-11-23-pebble-ui-transition-analysis.md`.

## What changes

The web panel (`apps/web`) moves from the stock shadcn look to the Pebble design: one teal brand colour, large radius, soft shadows, a rounded font, 16 px text, 48 px buttons, a floating sidebar on a desktop and a bottom tab bar on a phone. The drawing is `design/ui-proposals/proposals/03-pebble/index.html` (12 screens, phone and desktop, light and dark). It is a pattern, not a full specification: it shows about 40 % of what a user can see. Every other page, state and dialog follows the same patterns (owner, 2026-11-23).

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
| PB-7 | Mockup items with no data today are cut: "12 approved this week", "3 min on average", "about two minutes", "6.5 hours", "mails today", the mailbox pause button, the counts on delegate cards, the weekly bar chart. The "why" box shows only facts the API gives. A new metric is a later ticket by the metric rule. | default |
| PB-8 | Voice: friendly headings and buttons ("Yes, send it", "Was I right?"). No first-person past tense (Polish needs a gender for it). No inflected name in a greeting. A promise in the UI must be true today and agree with the legal claims ledger. | default |
| PB-9 | Brand: the name "Email Assistant" stays. Favicon, app icons, manifest colours and `theme-color` move from navy to teal. The docs site takes the teal accent, the mark and the font. The report mail does not change. | default |
| PB-10 | Font: Nunito, self-hosted, Latin and Latin Extended. Dark mode follows the system setting; no manual switch. | default |
| PB-11 | The operator console gets the theme and keeps dense tables. | default |
| PB-12 | The owner looks twice at the contact sheet (§ Proof): after F166 and F167 land (a look, not a stop), and before the release in F172 (a stop: the release waits for "go"). The release also waits for the 20-draft check of the reply-draft pilot. | default |
| PB-13 | The mockup is committed for the build and deleted in F172. After that the design system ADR, the pattern page and the code are the truth. | owner step: the repo is public |

## Design decisions

| Id | Decision |
| --- | --- |
| DB-1 | Invariants for every ticket: no DB migration, no API or schema change in `packages/core/src/web`, no URL, query or anchor change, no `bun.lock` change. A stage that needs to break one stops and asks. |
| DB-2 | All colour, radius, shadow and font values live in `apps/web/src/styles/global.css` as tokens. A component uses token classes only (`bg-primary`, `text-muted-foreground`); no palette class (`bg-amber-50`), no hex value, no inline `style`. A scan test enforces it. |
| DB-3 | Token values are the mockup's values, changed where WCAG 2.2 AA fails. The fixed values are in `spec/features/*/F166-*/interfaces.md` and in the design system ADR. Every text pair is at least 4.5:1; a control boundary is at least 3:1. |
| DB-4 | The e2e a11y scan runs in the light and the dark scheme. |
| DB-5 | `components/ui/` holds shadcn CLI output. A new primitive still comes from the CLI. Editing variants, sizes and classes of an existing file is allowed and is how the theme reaches the primitives. Pattern components are app code in `components/patterns/`. |
| DB-6 | Sizes: text 13, 14, 16, 18, 20, 30 px; a control is 48 px high (44 px compact, 36 px only in dense tables); radius 10, 16, 22, 28 px and full. One breakpoint pair: phone layout below `lg` (1024 px), desktop from `lg`; a page with two columns uses one column below `lg`. |
| DB-7 | Layout rules: no sideways scroll at 320 px; the bottom tab bar respects the safe-area inset; a card has a border in forced-colors mode; motion stops under `prefers-reduced-motion`. |
| DB-8 | A category has one look (icon and colour token) in one typed record with a test against the category enum. Emoji leave the panel texts. A delegation status maps to its column the same way. |
| DB-9 | The page head (title, one lead line, one action) is rendered by the shell from props that the island passes. Islands do not render their own `h1`. |
| DB-10 | Texts: every string is a key in `en` and `pl`. A key that no source file reads is deleted in the same stage; a test fails on an unused key. |
| DB-11 | Each stage updates its part of `docs/capabilities/web-panel.md` and the user docs page of a page it changes (`docs/code-patterns.md` § Capability map). |

## Patterns

Names are fixed here; F166 builds them and defines their props in its `interfaces.md`.

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

- **Contact sheet** (`bun run ui:sheet`, built in F166): every route × phone and desktop × light and dark × English and Polish × organization state, as PNG files with one HTML index. A stage that changes a page runs it for that page and reads its own pictures next to the mockup shots before it says done. The owner reads the full sheet at the two looks of PB-12.
- **Pattern page**: a page of the dev and e2e build that shows every primitive and pattern in each variant. It is not in the production build.
- The existing e2e spec of a page and its a11y scan pass in both schemes.

## Tickets and order

```
F166 design system ─► F167 shell, brand, sign-in pages ─► F168 approvals, activity, review        ─┐
                                                      ├► F169 delegations, open loops, rules       ├► F171 docs, shots, video ─► F172 cleanup, release
                                                      └► F170 onboarding, mailboxes, settings, …   ─┘
```

F168, F169 and F170 run next to each other. They share the text group files, `nav-items.ts` and `docs/capabilities/web-panel.md`; a land conflict is solved by "merge `master`, prove again". The plan of F167–F170 needs the `interfaces.md` of F166. The demo video and docs shots ticket (F151) finishes its tool stages now; its takes are made again in F171.
