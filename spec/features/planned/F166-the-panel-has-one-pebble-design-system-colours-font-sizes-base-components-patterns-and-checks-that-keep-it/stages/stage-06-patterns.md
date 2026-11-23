# F166 stage 06 — Patterns and the category look

Part of [`../plan.md`](../plan.md). Needs: stage 04 (`Button`, `Card`, `Badge`, the pattern page). May run next to 05.

## Step 1 — The category look

- **Files:** `apps/web/src/lib/category-look.ts` and its test; classes for the seven `--cat-*` tokens.
- **Decisions:** DB-8. `categoryLook: Record<Category, { icon: LucideIcon; tone: string }>` over the category enum of `@ea/core`. Icons (lucide): urgent `AlertTriangle`, needs reply `Reply`, delegation `Users`, info `Info`, notification `Bell`, spam `Ban`, unsure `HelpCircle`. `tone` is one whole class name per category (Tailwind keeps only names that appear whole in the source).
- **Test:** (1) the keys of `categoryLook` equal the enum values (a new enum value fails the test). (2) Every `tone` class is in the built CSS.

## Step 2 — The patterns

- **Files:** `apps/web/src/components/patterns/` (one file per pattern, `index.ts`), one section file each in `apps/web/src/dev/sections/`, a render test per pattern in `apps/web/src/lib/` (like `approvals-components.test.tsx`).
- **Interfaces:** exactly the signatures of `../interfaces.md` § Patterns. Patterns take ready strings and call no `t()`.
- **Decisions, by pattern (mockup class in brackets):**
  - `PageHead` (`.pagehead`): one `h1`, `text-3xl` from `lg`, `text-2xl` below; the lead is hidden below `lg` only when an action is present; the action wraps under the title on a phone.
  - `SectionCard` (`.sec`): an icon tile in the soft tint, an `h2`, the lead; `tone="danger"` has a destructive edge, no shadow.
  - `RowList`, `Row` (`.line`): a divider between rows, none before the first; the control wraps under the text below 360 px.
  - `CategoryPill` (`.pill`): icon and label; the colour is never the only signal.
  - `InitialsAvatar` (`.avatar`): one or two letters from the first two words; five fixed tone classes; the same name always gets the same tone; white text must pass 4.5:1 on each tone (pick the five from the category tokens' light values or darker).
  - `ProgressRing` (`ring()` in the mockup script): SVG attributes only, no inline style; `value > max` draws a full ring, `max = 0` an empty one; `role="img"` with `label`.
  - `StepDots` (`.steps`): dots for `total ≤ 8`, one bar above; `label` is the text a screen reader gets ("Draft 1 of 5").
  - `FilterChips` (`.flt`): buttons with `aria-pressed` in a group named by `label`; `single` keeps exactly one pressed; the row wraps.
  - `EmptyState` (`.empty`, `.blob`): the blob shape, the title as `h2`, the buttons under it.
  - `StatTile` (`.fact`), `FactBox` (`.whybox`, built on `Alert` `accent`; without stage 05 on your base, add the variant yourself and tell the coordinator).
  - `StickyActions` (`.decide` phone rule): fixed above the tab bar with the safe-area inset below `lg`, in the flow from `lg`; it reserves its own height so no content hides under it.
- **Test:** (3) `InitialsAvatar` "Tomasz Nowak" renders `TN`, "anna" renders `A`, and two renders of one name have the same class. (4) `ProgressRing` with `value 2, max 10` has a dash array of 20 % of the circumference; with `max 0` of 0. (5) `StepDots` with `total 5` renders 5 dots, with `total 12` none and one bar. (6) `FilterChips` `single`: a click on a second chip calls `onChange` with only that value. (7) `PageHead` renders exactly one `h1`. (8) `patterns.spec.ts` scans the new sections in both schemes; at 320 px the pattern page has no sideways scroll.

## Out of scope

Use of a pattern in a real page (the page tickets). The shell (F167 calls `PageHead`). Charts.

## Done when

You opened the pattern page pictures next to the mockup shots `approvals-*`, `settings-*`, `stats-*` and `empty-*`; the Proof of `../plan.md` (stages 03–06) prints `PROOF_OK`.
