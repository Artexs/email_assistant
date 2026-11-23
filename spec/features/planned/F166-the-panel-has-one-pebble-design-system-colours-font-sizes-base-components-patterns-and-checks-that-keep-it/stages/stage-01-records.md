# F166 stage 01 — Records: the design system ADR and the web rules

Part of [`../plan.md`](../plan.md). Needs: nothing. May run next to 02.

## Step 1 — ADR

- **Goal:** one accepted record of the design system that outlives the mockup (PB-13).
- **Files:** `docs/decisions/0037-panel-design-system.md` (new; take the next free number if 0037 is used), `docs/decisions/README.md`.
- **Content:** context (the stock look, the owner's choice of Pebble on 2026-11-23); the decision: the token table and the type, size and radius scales of `../interfaces.md` (copy the values: after F172 the ADR is the reference); DB-2 to DB-10 of the programme page; the dark-mode policy (D3); the font and its licence (D6); the allowed raw colour (D10); the pattern page and its text exception (D8); the a11y bar (4.5:1 text, 3:1 control edge, both schemes). Rejected options: a new component library, a manual theme switch, a redesign flag.
- **Done when:** the ADR follows the form of `docs/decisions/0036-*.md` and names no ticket by a bare code (write the folder path).

## Step 2 — Web rules

- **Goal:** the rules that workers read say what the ADR decides.
- **Files:** `docs/code-patterns.md` (the web rules near "shadcn components come from the shadcn CLI"), `.agents/limen/styleguide.md` (§ Shape, the Web line; § Avoid).
- **Decisions:** DB-2, DB-5, DB-8, DB-9, DB-10.
- **Content for `docs/code-patterns.md`:** token classes only, with the three bans; a new primitive comes from the CLI, and variants and sizes of an existing primitive may be edited; patterns live in `components/patterns/` and a page uses a pattern before it builds its own markup; the shell renders the page head; a category look comes from `category-look.ts`; an unused text key is deleted. Point to the ADR for values.
- **Content for the styleguide:** one line in § Shape ("Web look: tokens, primitives and patterns of the design system ADR") and one in § Avoid ("A palette class, a hex colour or an inline style in a web component; an island with its own `h1`").
- **Out of scope:** `docs/capabilities/web-panel.md` (page tickets), any code.

## Test

1. `bun run lint` passes on the changed files (the bare-code scan covers docs strings).
2. Every token of `../interfaces.md` § Tokens is in the ADR with the same value (compare by eye; list the count in the final message: 17 token rows, 7 category rows).

## Done when

Both steps are committed and the Proof of `../plan.md` (stages 01, 02, 07) prints `PROOF_OK`.
