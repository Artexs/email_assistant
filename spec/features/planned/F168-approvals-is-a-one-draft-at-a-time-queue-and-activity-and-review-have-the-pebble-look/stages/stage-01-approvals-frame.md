# F168 stage 01 — Approvals frame and the draft card

Needs F166 stage 03: tokens. Needs F166 stage 06: `InitialsAvatar`. Needs F166 stage 09: `AppShell` `lead`. Needs F166 stage 10: `FactBox`, `EmptyState`. May run next to 02, 03, 06, 07, 08.

Part of [`../plan.md`](../plan.md). The page keeps today's flow (list and detail); stage 04 changes the flow. This stage gives it its parts and look.

## Step 1 — The draft card

- **Files:** `components/approvals/ApprovalCard.tsx` (new; it takes the place of `ApprovalDetailPanel.tsx`), `ApprovalSummary.tsx`, `AddressList.tsx`.
- **Interface (D1):** `ApprovalCard({ detail: ApprovalDetail; now: Date; titleRef?: Ref<HTMLHeadingElement>; children: ReactNode })`. `children` is the area for the decision bar and the messages (stage 04 fills it). The root is a `section` with the accessible name `appr_detail_label` (D5).
- **Decisions (mockup `02-approvals-*`):**
  - Head row: `InitialsAvatar` of the first recipient (name, else address), then the title as `h2` with `tabIndex={-1}` and the `titleRef`. Keep the title rule of today: the kind title, the recipient in a `bdi`, punycode for a lookalike domain, the inactive mark.
  - The card shows every fact that `ApprovalSummary` shows today (test-mail badge, From with the external warning, To, Cc, Reply-To, subject, follow-up number, due date, version, state, time left, "preparing"). None hides behind a toggle: they are the checks before a send. The meta lines use `text-sm text-muted-foreground`; the external warning is a `Badge` `destructive`.
  - `FactBox` titled "About this draft" (P8) holds the sender line (`senderLineText`) and, for a reply, the `instruction`. No `FactBox` when both are absent.
  - The draft body sits in a muted box (`bg-muted`, radius `md`, `text-base`, `whitespace-pre-wrap`). The quote is a `details` disclosure for every kind (today only a reply has it closed). The gaps box of a reply comes first, in the `destructive-soft` look, with its `h3`.
  - No view (retention): the state text and `appr_no_content`.
- **Test** (`lib/approvals-components.test.tsx`): (1) a card for a `delegation` with `view.recipient = { name: "Anna Nowak", address: "anna@example.com" }` has one `h2` with "Anna Nowak", the avatar text "AN" and the region name of `appr_detail_label`. (2) A reply with `gaps: ["date"]` renders the gaps heading before the body. (3) A card with `sender: null` and no instruction has no `FactBox`. (4) A view with `sender.external: true` shows the `appr_external` badge.

## Step 2 — The waiting list and the frame

- **Files:** `components/approvals/WaitingList.tsx` (new; it takes the place of `ApprovalList.tsx`), `islands/ApprovalsPage.tsx` (layout and head only), `i18n/texts/en-approvals.ts`, `pl-approvals.ts`.
- **Interface (D1):** `WaitingList({ items: readonly ApprovalItem[]; focusId: string | null; now: Date; onPick(id: string): void })`. A `list` with the name `appr_list_label`; each item is a link `/approvals?id=<id>` (plain click calls `onPick`, a modifier click keeps the link) with `aria-current` on the focus. Two groups: waiting drafts, then held sends under the heading "Approved, not sent yet" (P1). Each row: `InitialsAvatar`, the title, the subject, one line of state and time left.
- **Frame:** from `lg` two columns: the card (wide) and an "Up next" card with the `WaitingList` (narrow). Below `lg` one column, as today. The island passes `lead` to `AppShell`: the count of waiting drafts (P8): `tp` with `{n}`, the form "100 or more" when the list has 100 items, and "Nothing waits for you" at 0. No `action`.
- **Empty list:** `EmptyState` with an icon, "Nothing waits for you", one line, and a button to `/activity`. The flag-off text `appr_off` is an `EmptyState` with no button.
- **Text keys:** new keys next to the `appr_*` keys. Delete the keys this stage stops reading.
- **Test:** (5) `WaitingList` with 2 waiting and 1 held item renders 3 links and the held heading once, after the waiting links. (6) The lead text for n = 1, 5, 100 in `en` and n = 2, 5 in `pl` (Polish plural forms).

## Out of scope

The queue, the decision bar, "Later", the sent state and the deep-link closed card (stages 03 and 04). `ApprovalEditDialog`, `ReplyControls` (stage 02). Any spec of another ticket.

## Done when

- `approvals.spec.ts` passes with only locator changes for the new layout; `reply-panel.spec.ts`, `open-loops.spec.ts` and `delegations.spec.ts` pass unchanged.
- The contact sheet pictures of `approvals` are read next to the mockup shots `02-approvals-*`.
- Proof of `../plan.md` with the specs `approvals.spec.ts reply-panel.spec.ts open-loops.spec.ts delegations.spec.ts` prints `PROOF_OK`.
