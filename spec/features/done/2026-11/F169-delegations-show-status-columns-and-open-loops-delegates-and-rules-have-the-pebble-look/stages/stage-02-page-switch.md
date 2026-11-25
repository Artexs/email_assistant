# F169 stage 02 — The page head and the switch of the two delegation pages

Part of [`../plan.md`](../plan.md). Needs F166 stage 03 (tokens), stage 08 (`web:build:dev`, `patterns.spec.ts` of Proof B) and stage 09 (`AppShell` `lead` and `action`). May run next to 01 and 06–10. Stages 03, 04 and 05 use `PillNav` and `DelegationSwitch` from this stage.

Mockup: the `.tabsp` pill group in the page head of screen `delegations`.

## Step 1 — `PillNav`

- **Files:** `components/delegation/PillNav.tsx` (new) and a render test in `apps/web/src/lib/`.
- **Interface (stages 04 and 05 use it):**
  ```ts
  PillNav<K extends string>({ label: string; items: { key: K; href: string; label: string }[]; current: K; onSelect?: (key: K) => void })
  ```
- **Decisions:** D14. A `nav` named `label` with plain links; `aria-current="page"` on `current`; the pill-group look (muted track, card-coloured current item, 44 px items, full radius). With `onSelect`, a plain left click calls it and prevents the default; a click with a modifier key or a middle click keeps the link's own behaviour. The plain-click check moves here from `LoopTabs.tsx` as an exported `isPlainClick`; `LoopTabs.tsx` imports it (one import line; stage 04 changes the rest of that file).

## Step 2 — The switch in the page head

- **Files:** `components/delegation/DelegationTabs.tsx`, `islands/DelegationsPage.tsx`, `components/loops/OpenLoops.tsx` (one line), `components/delegation/Delegations.tsx` (one line).
- **Interface (stage 05 uses it):** `DelegationSwitch({ current: DelegationTab })`, exported from `DelegationTabs.tsx`.
- **Decisions:** D13.
  - At HEAD `DelegationTabs` has no flag check and no `useMe`. It stays a pure component with the same props, `nav` name `dlg_tabs_label` and links, and renders through `PillNav`. Its tests in `lib/delegates-components.test.tsx` render it bare and keep their assertions (`PillNav` puts `href` before `aria-current`).
  - `DelegationSwitch` reads `useMe()` and renders `DelegationTabs` only when `me.features` holds `delegation_pages`. This keeps what a user sees today: with the flag off, `/delegations` and `/delegates` return `dlg_off` before their tabs, and `OpenLoops` hides them (`delegationsOn`). Nothing changes for a flag-off user.
  - `DelegationsPage` passes `lead="dgn_lead"` and `action={<DelegationSwitch current="delegations" />}` to `AppShell`. `Delegations` and `OpenLoops` no longer render `DelegationTabs` in their bodies; `OpenLoops` keeps `delegationsOn` for its content. `DelegatesPage` is stage 05's.
  - Lead text (one key for both views of `/delegations`): `dgn_lead` "Work you handed over, and what waits for an answer." / "Praca przekazana innym i to, co czeka na odpowiedź." Next to `title_delegations` in `texts/en-approvals.ts` and `pl-approvals.ts` (stage 01 adds its keys at the `dgn_*` keys).
  - On a phone the action wraps under the title and the lead is hidden (the `PageHead` rule of F166 stage 09).

## Tests

1. `PillNav` render test (`renderToStaticMarkup`, as every web unit test; no DOM library and no `bun.lock` change): two items, the `current` one has `aria-current="page"`, the other none. A `test.each` of `isPlainClick` on plain event objects: a left click with no modifier is `true`; ctrl, meta, shift, alt or `button: 1` is `false`.
2. `lib/delegates-components.test.tsx`: the two `DelegationTabs` cases pass unchanged. New: `DelegationSwitch` inside a `MeContext.Provider` (as `lib/notify-cards.test.tsx` does) with `features: []` renders an empty string; with `["delegation_pages"]`, a `nav` named `dlg_tabs_label` with two links.
3. `delegations.spec.ts`: the header case finds the `nav` `dlg_tabs_label` with `aria-current` on Delegations and `href="/delegates"` on Delegates; it now sits in the page head (no locator change expected).
4. `open-loops.spec.ts`: the link `dlg_tab_delegates` still shows with both flags on. `delegations.spec.ts` T16 and `delegates.spec.ts` T8 (flag off, no tabs) pass unchanged.
5. Both specs keep their a11y scans.

## Docs

`docs/capabilities/web-panel.md` rule 9: the Delegations/Delegates switch is in the page head.

## Out of scope

The columns (stage 03); the loop tabs' look (stage 04); the Delegates page body (stage 05).

## Done when

Tests 1–5 pass; you opened the sheet pictures of `delegations` (phone and desktop); Proof B with `delegations.spec.ts open-loops.spec.ts` prints `PROOF_OK`.
