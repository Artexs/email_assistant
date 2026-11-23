# F166 interfaces: names and values that later tickets use

Part of [`plan.md`](plan.md). The tickets F167–F172 read this file. A change here after F166 lands is a change of every page ticket: ask first.

## Tokens (`apps/web/src/styles/global.css`)

Values are the Pebble mockup's, changed where WCAG AA failed (contrast computed 2026-11-23; the reason is in the last column).

| Token | Light | Dark | Note |
| --- | --- | --- | --- |
| `--background` | `#f3f6f5` | `#0d1513` | |
| `--foreground` | `#13201d` | `#e4efec` | |
| `--card`, `--popover` | `#ffffff` | `#16211e` | `*-foreground` = `--foreground` |
| `--muted`, `--secondary` | `#e8efed` | `#1d2b27` | `--secondary-foreground` = `--foreground` |
| `--muted-foreground` | `#586b66` | `#95aba5` | |
| `--border` | `#dbe5e2` | `#24332f` | dividers and card edges only |
| `--input` | `#6e968a` | `#4f7067` | new value: the edge of a field, a switch track and an outline button; 3:1 on card and background |
| `--primary` | `#0a7568` | `#3fd1b9` | mockup light `#0a7a6c` gave 4.36:1 on the soft tint |
| `--primary-foreground` | `#ffffff` | `#04201b` | |
| `--primary-soft` | `#d5f0ea` | `#133b34` | new; text on it is `--primary` |
| `--accent` | `#fff1e0` | `#3a2a14` | the warm box; hover fills use `--muted`, not `--accent` |
| `--accent-foreground` | `#8a4b00` | `#ffc983` | |
| `--destructive` | `#af3434` | `#ff7c7c` | mockup light `#c23a3a` gave 4.30:1 on its soft tint |
| `--destructive-foreground` | `#ffffff` | `#2b0707` | new; white on the dark value gave 2.49:1 |
| `--ring` | `--primary` at 60 % | same | focus: 3 px ring, 2 px offset |
| `--sidebar` | `#ffffff` | `#121c19` | the other `--sidebar-*` and the `--chart-*` tokens go if nothing reads them |
| `--shadow-card` | `0 1px 2px rgb(16 40 34 / .05), 0 12px 32px -8px rgb(16 40 34 / .12)` | `0 1px 2px #0006, 0 12px 32px -8px #0008` | |
| `--radius` | `1.375rem` | same | scale: `sm` 10 px, `md` 16 px, `lg` 22 px, `xl` 28 px |

Category tokens, one per value of the category enum of `@ea/core` (name `--cat-<value>`, `_` written as `-`):

| Category | Light | Dark |
| --- | --- | --- |
| urgent | `#af3434` | `#ff7c7c` |
| needs reply | `#235ebf` | `#7fb0ff` |
| delegation | `#7741c8` | `#c3a0ff` |
| info | `#4b5d73` | `#a8b6c7` |
| notification | `#096e61` | `#3fd1b9` |
| spam | `#87581b` | `#e0ad6b` |
| unsure | `#8f5400` | `#ffc46b` |

A pill is the colour as text on a 14 % mix of the same colour with the surface. An enum value with no row here gets the `info` colours and a note in the stage's final message.

Type: `text-xs` 13 px, `text-sm` 14 px, `text-base` 16 px, `text-lg` 18 px, `text-xl` 20 px, `text-3xl` 30 px (page title; `text-2xl` on a phone). Font family token `--font-sans`: `"Nunito Variable", ui-rounded, ui-sans-serif, system-ui, sans-serif` plus the emoji fonts of today.

## Primitives (`apps/web/src/components/ui/`)

Existing names and props stay valid: no feature file must change in F166.

- `Button` variants: `default` (teal), `soft` (new: soft tint, teal text), `secondary` (muted fill), `outline`, `ghost`, `destructive`, `destructive-soft` (new), `link`. Sizes: `lg` 52 px, `default` 48 px, `sm` 44 px, `xs` 36 px; `icon-lg`, `icon`, `icon-sm`, `icon-xs` the same heights. Shape: full radius, bold text.
- `Card`: radius `lg`, `--shadow-card`, no border; a 1 px border only in forced-colors mode.
- `Badge` variants: `default` (soft teal), `secondary` (muted), `outline`, `destructive` (soft red). Full radius, 13 px bold.
- `Input`, `Textarea`, `SelectTrigger`: 48 px high (textarea 96 px minimum), 16 px text, radius `md`, 2 px edge in `--input`.
- `Switch`: 52 × 30 px. `Tabs`: a pill group (muted track, card-coloured active tab).
- `Alert` variants: `default`, `destructive`, `accent` (new: the warm box).
- `Dialog`, `Sheet`, `DropdownMenu`, `Tooltip`, `Table`, `Skeleton`, `Toaster`: tokens and radius only; their props do not change.

## Patterns (`apps/web/src/components/patterns/`, one file per pattern, no index file: import from the pattern's file)

```ts
PageHead({ title: string; lead?: string; action?: ReactNode })            // the only h1 of a page; the shell calls it (stage 09)
SectionCard({ icon: LucideIcon; title: string; lead?: string; tone?: "default" | "danger"; children: ReactNode; ...div props })  // renders h2
RowList({ children })   Row({ title: string; hint?: ReactNode; leading?: ReactNode; children?: ReactNode })  // children = the control at the end
CategoryPill({ category: Category; label: string })                       // icon and colour from categoryLook
InitialsAvatar({ name: string; size?: "sm" | "default" })                 // colour = one of 5 classes, picked by a stable hash of name
ProgressRing({ value: number; max: number; size?: "sm" | "default" | "lg"; label: string; children?: ReactNode })  // role="img", label is its name
StepDots({ current: number; total: number; label: string })               // dots up to 8 steps, a bar above 8
FilterChips<T extends string>({ label: string; options: { value: T; label: string }[]; value: T[]; onChange(next: T[]): void; single?: boolean })
EmptyState({ icon: LucideIcon; title: string; text?: string; children?: ReactNode })  // children = the next-step buttons
StatTile({ value: string; label: string })
FactBox({ icon?: LucideIcon; children: ReactNode })                        // own markup with the accent tokens; same look as Alert "accent"
StickyActions({ children: ReactNode })                                     // fixed above the tab bar below lg; in the flow from lg
```

`apps/web/src/lib/category-look.ts`: `categoryLook: Record<Category, { icon: LucideIcon; tone: string }>` where `tone` is the class that sets the pill colours. Patterns take ready strings: the caller calls `t()`.

## Shell contract (stage 09)

```ts
AppShell({ active: NavKey; title: TextKey; lead?: TextKey; action?: ReactNode; children: ReactNode })
```

The shell renders one `PageHead` at the top of `main` for every width. An island passes the lead key and the one main action of its page (for example "Connect mailbox"); it renders no `h1` and no page title of its own. The shell ticket (F167) changes how the frame looks, not these props.

## Tools

- Pattern page sections: one file per item in `apps/web/src/dev/sections/`, each with `export const section = { title: string; order: number; render: () => ReactNode }`. The page finds them with `import.meta.glob`. A button with `data-open-demo` opens an overlay that the generic spec opens and scans.

- `bun run ui:sheet` → `test-results/ui-sheet/index.html` and PNG files `<state>/<route>-<phone|desktop>-<light|dark>-<en|pl>.png`. `UI_SHEET_ROUTES=approvals,rules` limits the routes.
- Pattern page: `/dev/patterns`, only in a build with `EA_DEV_PAGES=1` (the dev server and the e2e build set it).
- `expectNoA11yViolations(page, scope)` checks the light and the dark scheme.
