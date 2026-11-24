# F169 stage 05 — The Delegates page in the Pebble look

Part of [`../plan.md`](../plan.md). Needs stage 02: `DelegationSwitch`. Needs F166 stage 03 (tokens), stage 06 (`InitialsAvatar`), stage 09 (`AppShell` `lead` and `action`), stage 10 (`SectionCard`, `EmptyState`). May run next to 01, 03, 04 and 06–10. It reads `DelegationTabs.tsx` and does not edit it (stage 02 owns it).

Mockup: the delegate strip and the "Add a delegate" card of screen `delegations`, without the counts (PB-7).

## Step 1 — Page head and delegate cards

- **Files:** `islands/DelegatesPage.tsx`, `components/delegation/DelegateList.tsx`.
- **Decisions:** D13, D15.
  - Page head: lead `dlg_lead` "The people you can hand work to." / "Osoby, którym możesz przekazać pracę."; the action is `<DelegationSwitch current="delegates" />` (it hides itself with the flag off, as the body tabs do today). The island no longer renders `DelegationTabs` in its body.
  - The list stays one `ul` named `dlg_list_label`, active delegates first as today. Each `li` is a card: `InitialsAvatar` of the name, the name, the address (wraps, never widens the page), the tags as `Badge` `outline` in a list named `dlg_tags` (or `dlg_tags_none`), the state badge (`dlg_state_active` / `dlg_state_off`), then Edit and the switch. The card grid uses `auto-fit` columns of at least 16 rem from `lg`, one column below (DB-6).
  - Ids and names stay: `editButtonId`, `switchId`, `dlg_edit_for`, `dlg_switch_label`; the member sees a disabled switch and no Edit.
  - An empty list (owner or member) is `EmptyState` (icon `Users`, title `dlg_empty`, text `dlg_empty_text` "Add a delegate with the form above." / "Dodaj osobę formularzem powyżej." for an owner who can write; no text for others). The flag-off text `dlg_off` stays a plain card line.

## Step 2 — The add form and the dialogs

- **Files:** `components/delegation/DelegateAddForm.tsx`, `DelegateEditDialog.tsx`, `DelegateOffDialog.tsx`, `TextField.tsx`.
- **Decisions:**
  - The add form is a `SectionCard` (icon `UserPlus`, title as today) that keeps `data-card="add-delegate"`. Fields keep their labels (`dlg_name`, `dlg_email`, `dlg_tags`), their errors with `role="alert"`, their checks (`delegates-form.ts`) and every 400 and 409 text (`dlg_exists`, `dlg_mailbox_address`, …). It stays above the list. No dialog (D15).
  - The two dialogs keep their texts, their first focus and the focus return; look from the primitives only. The turn-off button is `destructive`.
  - The status line (`role="status"`, `tabindex="-1"`) and the owner-only line stay.
- **Texts:** `dlg_lead` next to `title_delegates`, `dlg_empty_text` next to `dlg_empty`, both of `texts/en-approvals.ts` and `pl-approvals.ts`. Remove emoji from `dlg_*` texts if any are there.

## Tests

1. `delegates-components.test.tsx`: a row of "Tomasz Nowak" renders `TN`, the address, two tags in the list named by `dlg_tags`, and for `canChange: false` a disabled switch and no Edit button.
2. The same file: an empty list for an owner renders a heading with the `dlg_empty` text and the `dlg_empty_text` line; for a member, the heading only.
3. `delegates.spec.ts` passes; its locators (`data-card="add-delegate"`, the labels, `dlg_list_label`, the switch and edit names, `dlg_edit_title`) do not change. A locator that must change is named in the final message.
4. The spec's a11y scans pass on both projects; mobile project: `scrollWidth <= innerWidth` with a delegate whose address has 60 characters (seed or test data of the spec).

## Docs

`docs/capabilities/web-panel.md` rule 9, the Delegates part, only where a sentence names the look. No user docs page (D19: stage 03 owns `delegate-and-follow-up.mdx`).

## Out of scope

Counts per delegate; the delegates API; a dialog for the add form; the Delegations page.

## Done when

Tests 1–4 pass; you opened the sheet pictures of `delegates`; Proof B with `delegates.spec.ts` prints `PROOF_OK`.
