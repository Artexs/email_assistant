# F169 stage 04 — The Open loops board in the Pebble look

Part of [`../plan.md`](../plan.md). Needs stage 02: `PillNav.tsx`. Needs stage 03: the Delegated-tab wiring in `OpenLoops.tsx`. Needs F166 stage 03 (tokens), stage 06 (`InitialsAvatar`), stage 10 (`EmptyState`). May run next to 05–10.

The mockup has no Open loops screen (PB-3): use the cards of the `delegations` screen and the tabs of the `activity` screen.

## Step 1 — Tabs and filters

- **Files:** `components/loops/LoopTabs.tsx`, `components/loops/OpenLoops.tsx`.
- **Decisions:** `LoopTabs` and `LoopFilterTabs` render through `PillNav` (stage 02). They keep their `nav` names (`lp_tabs_label`, `lp_filters_label`), their links (`?tab=`, `?filter=`), `aria-current` and the plain-click rule. The page wrapper drops `max-w-3xl` where the columns of the Delegated tab need the width; the Waiting and Promised lists keep a readable width of about 48 rem.

## Step 2 — Loop cards and empty states

- **Files:** `components/loops/LoopRow.tsx`, `components/loops/LoopsBoard.tsx`, `components/loops/LoopConfirmDialog.tsx`.
- **Decisions:**
  - A loop row is a card like a delegation card (stage 03): `InitialsAvatar size="sm"` of the counterpart or the delegate, the name, the text (else the subject), the reason line, the due date with "stated" or "default", the follow-up count. The notes "matched by subject" and "auto-reply only" are `Badge` `secondary`.
  - Buttons keep `loopActions` (`lib/loops-view.ts`), their accessible names (person and text), their order and their rules. Draft follow-up is `soft`, Later and Done `outline`, Drop and Stop tracking `ghost`, Reopen `outline`. The link to `/approvals?id=` while a follow-up waits stays.
  - An empty list shows `EmptyState` (icon `Inbox`, `headingLevel={3}` when the list has a visible heading, else 2) with the text of `LOOP_FILTER_EMPTY` as its title and no button. On the Delegated tab under the columns, it is `headingLevel={3}`.
  - The status line (`role="status"`, `tabindex="-1"`) and its focus rules stay as they are.
  - The confirm dialog keeps its texts and its first focus on "Keep it"; look only.
- **Texts:** no new key is expected. If the empty state needs one, add it next to the `lp_*` keys of `texts/en-approvals.ts` and `pl-approvals.ts`. Remove emoji from the `lp_*` texts if any are there.

## Tests

1. `loops-components.test.tsx`: a waiting row renders the initials of the counterpart and keeps the accessible names of its buttons (one case per button that `loopActions` gives for an open waiting loop of an owner).
2. The same file: an empty Promised list renders one heading with the `LOOP_FILTER_EMPTY` text of its filter.
3. `open-loops.spec.ts` passes as it is after stage 03 (locators by role, name and key; no change expected). A locator that must change is named in the final message with the reason.
4. The spec's a11y scans pass on both projects; mobile project at the Waiting tab: `scrollWidth <= innerWidth`.

## Docs

`docs/capabilities/web-panel.md` rule 9, the Open loops part, only where a sentence names the look. No user docs page (D19).

## Out of scope

Loop actions, their API and their texts; the loop settings card (`LoopSettingsCard`, Settings page: the settings ticket); `loops-panel.spec.ts` (it covers Activity, Settings and Mailboxes).

## Done when

Tests 1–4 pass. You opened the sheet pictures of `delegations` for an organization with `open_loops` on, or, if the sheet has no such state, the e2e pictures of `open-loops.spec.ts` (say which); Proof B with `open-loops.spec.ts` prints `PROOF_OK`.
