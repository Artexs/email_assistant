# F172 stage 02 — Stock classes, unused variants and the unused dependency

Needs the last page stages (the sweep reads every panel source file): F169 stages 01–10 and F171 stage 03. Holds the board's one `bun.lock` lock (step 3). May run next to 01 (this stage owns `token-classes.test.ts`, `page-head.test.tsx`, `components/ui/`, `apps/web/package.json`, `bun.lock` and ADR 0037 decisions 5, 7, 8, 10, 15).

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D3, D4.

## Step 1 — Stock shadow guard and the stock class sweep

- **Goal:** no class of the stock shadcn look is left.
- **Guard:** a new rule "a stock shadow" in `token-classes.test.ts`: `shadow-(2xs|xs|sm|md|lg|xl|2xl)` and a bare `shadow` fail; the theme's `shadow-card` (and any other `--shadow-*` token) passes; `shadow-none` passes.
- **Sweep (one time, no guard):** read every hit of these markers in `components/`, `islands/`, `layouts/` and fix it or keep it with a reason:
  - a stock shadow (the guard above; `components/ui/select.tsx` has `shadow-md` at the plan base) → `shadow-card` or the overlay shadow the ADR names;
  - a control height under 44 px (`h-8`, `h-9`, `size-8`, `size-9` on a button, input, select or tab) outside a dense table (DB-6) → the 48 px or 44 px size of the primitive;
  - a page title size (`text-2xl`, `text-3xl`) outside `PageHead` and `AuthCard`;
  - an arbitrary pixel value (`-[NNpx]`) where a scale value exists; Radix data selectors (`data-[state=open]`) are not values and stay.
- **Record:** `sweep.md` in the ticket folder: one line per kept hit (file, class, DB-6 or ADR reason).
- **Test:**
  1. `className="shadow-md"` reports `a stock shadow "shadow-md"`.
  2. `className="shadow"` reports `a stock shadow "shadow"`.
  3. `className="shadow-card shadow-none"` reports nothing.
  4. The real source gives an empty list.
- **Check:** put `shadow-md` back once and see test 4 fail.

## Step 2 — Unused variants and sizes

- **Goal:** each variant and size of a primitive (`button`, `badge`, `card`, `tabs`, `toggle`, and every other `cva` in `components/ui/`) has at least one user (D4).
- **Do:** search the source (no tests, no `dev/`) for each `cva` variant and size key, also through a mapped record (a status-to-variant table). Remove a key with no user and its pattern page entry (`apps/web/src/dev/`). Keep `default`. List removed keys in `sweep.md`.
- **ADR:** change decision 8 of ADR 0037: "Every prop, variant and size name that exists stays valid" becomes "A variant or size with no user is removed; the pattern page shows each one that is left."
- **Test:** the pattern page spec (`patterns.spec.ts`) still passes; a primitive test that names a removed variant is removed with it.

## Step 3 — Remove `next-themes`

- **Do:** search the repo for a reader of `next-themes` once more (one found: stop and report), then `bun remove next-themes` in `apps/web` (D3).
- **ADR:** decision 15 keeps "no new dependency" and adds "the cleanup removed one unused dependency".
- **Check:** `bun install --frozen-lockfile` passes; `bun run web:build` passes.

## Step 4 — Allow lists match the ADR

- **Goal:** D2. Each entry of `ALLOWED`, `ACCENT_FILES` (`token-classes.test.ts`) and `H1_ALLOWED` (`page-head.test.tsx`) is named by file in ADR 0037, and the ADR names no entry the lists lack.
- **Do:** decision 5 names the three accent files (`FactBox`, `EmptyState`, `AuthErrorBanner`); decision 7 names each raw-colour file (`dialog.tsx`, `sheet.tsx`, `TotpQr.tsx`, `layouts/App.astro`, `layouts/Public.astro`); decision 10 names the three h1 owners (`PageHead`, `AppShell` for the no-organization card, `AuthCard`). If stage 01 reported a list entry for the unused-file guard, add it here. Remove a list entry whose file no longer needs it.
- **Test:** one new case per list: it reads ADR 0037 and checks that each file of the list is named in it. A list entry with no ADR line fails with the file name.
- **Check:** add a fake entry to `ACCENT_FILES` once and see the case fail.

## Out of scope

Text keys, emoji and unused files (stage 01). Layout changes from the visual review (stage 03).

## Proof

This stage changes many pages: it runs the full panel e2e suite.

`mkdir -p /tmp/f172-02 && bun run check:job > /tmp/f172-02/check.log 2>&1 && bun run lint:full > /tmp/f172-02/lint.log 2>&1 && bun run web:build:dev > /tmp/f172-02/build.log 2>&1 && bun run test:e2e > /tmp/f172-02/e2e.log 2>&1 && echo PROOF_OK`
