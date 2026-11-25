# F166 stage 06 — Patterns A and the category look

Part of [`../plan.md`](../plan.md). Needs: stage 03 (tokens); stage 08 (the pattern page and its spec); the mockup in the repo (`design/ui-proposals/proposals/03-pebble/`). May run next to 04, 05, 07, 09, 10.

## Step 1 — The category look

- **Files:** `apps/web/src/lib/category-look.ts` and its test.
- **Decisions:** DB-8. `categoryLook: Record<Category, { icon: LucideIcon; tone: string }>` over the category enum of `@ea/core`. Icons (lucide): urgent `AlertTriangle`, needs reply `Reply`, delegation `Users`, info `Info`, notification `Bell`, spam `Ban`, unsure `HelpCircle`. `tone` is one whole class name per category (Tailwind keeps only names that appear whole in the source). An enum value with no row in `../interfaces.md` § Tokens: see the rule there.
- **Test:** (1) the keys of `categoryLook` equal the enum values (a new enum value fails the test). (2) Every `tone` class is in the built CSS.

## Step 2 — Six patterns that show data

- **Files:** one file per pattern in `apps/web/src/components/patterns/` (no index file), one section file each in `apps/web/src/dev/sections/`, one render test per pattern in `apps/web/src/lib/` (model: `approvals-components.test.tsx`).
- **Interfaces:** exactly the signatures of `../interfaces.md` § Patterns. A pattern takes ready strings and calls no `t()`.
- **Decisions, by pattern (mockup class in brackets):**
  - `CategoryPill` (`.pill`): icon and label; the colour is never the only signal.
  - `InitialsAvatar` (`.avatar`): one or two letters from the first two words; the fill is one of the five classes `bg-avatar-1` … `bg-avatar-5`, picked by a stable hash of the name; the text class is `text-avatar-foreground` in both schemes (D2: no other colour).
  - `ProgressRing` (`ring()` in the mockup script): SVG attributes only, no inline style; `value > max` draws a full ring, `max = 0` an empty one; `role="img"` named by `label`.
  - `StepDots` (`.steps`): dots for `total ≤ 8`, one bar above 8; `label` is what a screen reader gets ("Draft 1 of 5").
  - `FilterChips` (`.flt`): buttons with `aria-pressed` in a group named by `label`; `single` keeps exactly one pressed; the row wraps.
  - `StatTile` (`.fact`): the number in tabular figures, the label under it.
- **Test:** (3) `InitialsAvatar` "Tomasz Nowak" renders `TN`, "anna" renders `A`, two renders of one name have the same class, and 50 different names use all five classes. (4) `ProgressRing` with `value 2, max 10` has a dash length of 20 % of the circumference; with `max 0`, of 0; with `value 12, max 10`, of 100 %. (5) `StepDots` with `total 5` renders 5 dots; with `total 12`, no dot and one bar. (6) `FilterChips` `single`: a click on a second chip calls `onChange` with only that value; without `single`, with both. (7) The generic spec of stage 08 passes with the new sections in both schemes.

## Out of scope

`PageHead` (stage 09). `SectionCard`, `RowList`, `EmptyState`, `FactBox`, `StickyActions` (stage 10). Use of a pattern in a real page (the page tickets). Charts. `patterns.spec.ts`.

## Done when

You opened the pattern page pictures next to the mockup shots `approvals-*`, `review-*` and `stats-*`; Proof C of `../plan.md` prints `PROOF_OK`.
