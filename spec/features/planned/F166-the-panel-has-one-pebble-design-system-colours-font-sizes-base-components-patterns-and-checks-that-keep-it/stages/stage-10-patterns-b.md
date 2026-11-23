# F166 stage 10 — Patterns B: the parts that build a page

Part of [`../plan.md`](../plan.md). Needs: stage 03 (tokens); stage 08 (the pattern page and its spec); owner step O1 (the mockup). May run next to 04, 05, 06, 07, 09.

## Step 1 — Five patterns

- **Files:** one file per pattern in `apps/web/src/components/patterns/` (no index file), one section file each in `apps/web/src/dev/sections/`, one render test per pattern in `apps/web/src/lib/`.
- **Interfaces:** exactly the signatures of `../interfaces.md` § Patterns. A pattern takes ready strings and calls no `t()`.
- **Decisions, by pattern (mockup class in brackets):**
  - `SectionCard` (`.sec`): a `Card` with an icon tile in the soft tint, an `h2`, the lead, then the children. `tone="danger"`: a destructive edge, no shadow, the tile in the destructive soft look. Extra `div` props (`id`, `data-card`, …) reach the root: the settings cards keep their names for tests and links.
  - `RowList`, `Row` (`.line`): a divider between rows, none before the first. A row is a title, an optional hint under it, an optional leading element, and the control at the end. Below 360 px the control wraps under the text. A `Row` does not label its control: the caller does (`aria-label` or a `Label`).
  - `EmptyState` (`.empty`, `.blob`): the blob shape with the icon, the title as `h2`, one sentence, then the buttons. The blob is decoration (`aria-hidden`).
  - `FactBox` (`.whybox`): the warm box with an optional icon; its own markup with the accent tokens, so it does not wait for the `Alert` variant of stage 05.
  - `StickyActions` (`.decide`, phone rule): below `lg` it is fixed above the tab bar with the safe-area inset and a top shadow; from `lg` it sits in the flow. It adds a spacer of its own height below `lg`, so the last content is never under it. One per page.
- **Test:** (1) `SectionCard` with `data-card="digest"` and `id="digest"` renders both on its root and one `h2`. (2) `SectionCard tone="danger"` has the destructive edge class and no shadow class. (3) `RowList` with three rows renders two dividers. (4) `EmptyState` renders its title as `h2` and its buttons after the text. (5) `StickyActions` renders its children once and a spacer element. (6) The generic spec of stage 08 passes with the new sections in both schemes, also at 320 px.

## Out of scope

The six patterns of stage 06 and `PageHead` (stage 09). Use of a pattern in a real page. The tab bar itself (the shell ticket): `StickyActions` reads the tab bar height from one CSS variable; name it in the final message so the shell ticket keeps it.

## Done when

You opened the pattern page pictures next to the mockup shots `settings-*`, `empty-*` and `approvals-phone-*`; Proof C of `../plan.md` prints `PROOF_OK`.
