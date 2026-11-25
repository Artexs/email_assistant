# F172 stage 02 — Stock classes, unused variants and the unused dependency

Needs stage 01: its guards, its `global.css` and ADR 0037 token table, and its `sweep.md` (D10). Holds the board's `bun.lock` lock (step 3). Owns `token-classes.test.ts`, `page-head.test.tsx`, `components/ui/`, `dev/`, the shadow tokens, `apps/web/package.json`, `bun.lock` and ADR 0037 decisions 1, 5, 7, 8, 10, 15.

Decisions D1–D4, D9.

## Step 1 — Shadow guard and the stock class sweep

- **Goal:** no stock shadcn class is left; every shadow value is a token (ADR 0037 decision 1).
- **Guard:** two new rules in `token-classes.test.ts`:
  - "a stock shadow": `shadow-(2xs|xs|sm|md|lg|xl|2xl)`, also after a variant (`hover:`), not after a letter, digit or `-` (`box-shadow` passes).
  - "an arbitrary shadow": `shadow-[`.
  - `shadow-none` and each `shadow-<token>` pass. The bare word `shadow` is no rule: it is also the mode value and a comment word.
- **Shadow tokens:** the two arbitrary shadows become tokens with ADR 0037 rows and the same values: `--shadow-button` (primary button, `button.tsx`) and `--shadow-bar` (phone decision bar, `StickyActions.tsx`). A stock shadow on an overlay (`select.tsx` `shadow-md`, menus, dialogs) becomes `shadow-card`: the ADR names no overlay shadow.
- **Sweep (one time):** in `components/`, `islands/`, `layouts/`, fix each hit or keep it with a line in `sweep.md` (file, class, reason):
  - a bare `shadow` class (by eye) → `shadow-card`;
  - a control under 44 px (`h-8`, `h-9`, `size-8`, `size-9`) outside a dense table (DB-6) → the 48 or 44 px primitive size;
  - `text-2xl`, `text-3xl` outside `PageHead` and `AuthCard`;
  - `-[NNpx]` where a scale value exists (Radix data selectors stay).
- **Test:**
  1. `className="shadow-md"` reports `a stock shadow "shadow-md"`.
  2. `className="hover:shadow-lg"` reports `a stock shadow "shadow-lg"`.
  3. `className="shadow-[0_1px_2px_red]"` reports `an arbitrary shadow`.
  4. `className="shadow-card shadow-none shadow-bar"` reports nothing.
  5. `transition-[color,box-shadow]`, `shadow: { name: "x" }` and `mode === "shadow"` report nothing.
  6. The real source gives an empty list.
- **Check:** put `shadow-md` back into `select.tsx` and see test 6 fail.

## Step 2 — Unused variants and sizes

- **Do (D4):** for each `cva` variant and size key in `components/ui/`, search the source (no tests, no `dev/`), also through mapped records (a status-to-variant table). Remove a key with no user and its pattern page entry; keep `default`. A primitive only the pattern page imports (`tabs.tsx`) stays (D9); its unused keys go. List removed keys in `sweep.md`.
- **ADR:** decision 8 "Every prop, variant and size name that exists stays valid" becomes "A variant or size with no user outside the pattern page is removed; the pattern page shows each one that is left."
- **Test:** `patterns.spec.ts` still passes; a primitive test that names a removed variant goes with it.

## Step 3 — Remove `next-themes` (only with consent)

- **Gate (D3):** only when the task says "remove next-themes: yes". Else skip, and write "next-themes kept, needs owner consent (questions.md 4)" in the final message.
- **Do:** search for a reader once more (one found: stop and report), then `bun remove next-themes` in `apps/web`.
- **ADR:** decision 15 keeps "no new dependency" and adds "the cleanup removed one unused dependency".
- **Check:** `bun install --frozen-lockfile` and `bun run web:build` pass.

## Step 4 — Allow lists match the ADR

- **Goal (D2):** each entry of `ALLOWED`, `ACCENT_FILES` and `H1_ALLOWED` is named in ADR 0037 by its path under `apps/web/src/` in backticks, the form the lists use (`components/settings/TotpQr.tsx`). The ADR names no entry the lists lack.
- **Do:** decision 5 names the three accent files, decision 7 each raw-colour file, decision 10 the three h1 owners (`AppShell.tsx` for the no-organization card), each by path. Add each entry of stage 01's `sweep.md`. Remove an entry whose file no longer needs it.
- **Test:** one case per list reads ADR 0037: each entry's path appears there in backticks; a missing path fails with the path.
- **Check:** add a fake entry to `ACCENT_FILES` and see the case fail.

## Out of scope

Text keys and emoji (stage 01). `docs/capabilities/web-panel.md` (stage 05). Visual review fixes (stage 04).

## Proof

`mkdir -p /tmp/f172-02 && bun run check:job > /tmp/f172-02/check.log 2>&1 && bun run lint:full > /tmp/f172-02/lint.log 2>&1 && bun run web:build:dev > /tmp/f172-02/build.log 2>&1 && bun run test:e2e > /tmp/f172-02/e2e.log 2>&1 && echo PROOF_OK`
