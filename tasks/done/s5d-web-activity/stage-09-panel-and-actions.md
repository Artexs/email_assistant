# s5d-web-activity — Stage 9

Part of [`../s5d-web-activity.md`](../s5d-web-activity.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 9 — Activity page part 2: panel, ✅ ✏️ ↩️, picker, toasts

Two steps. The buttons call the stage 6 routes; the words are the Telegram words (B2).

- [x] **9.1 `ActionButtons`, `CategoryPicker`, the row buttons (A1, A5, A6, A8, B13)**
  - Goal: every row has ✅, ✏️ and (when undoable) ↩️; each tap shows the Telegram toast and changes the row at once.
  - Files: create `apps/web/src/components/activity/ActionButtons.tsx`, `CategoryPicker.tsx`; change `ActivityRow.tsx`, `ActivityList.tsx`.
  - Interfaces:

    ```tsx
    // components/activity/ActionButtons.tsx
    export interface ActionButtonsProps {
      item: ActivityItem;
      onPatch(emailId: string, patch: Partial<Pick<ActivityItem, "feedback" | "undoable" | "undoPending">>): void;
      onGone(): void; // a 404: the list refreshes
    }
    export function ActionButtons(props: ActionButtonsProps): JSX.Element;

    // components/activity/CategoryPicker.tsx
    export interface CategoryPickerProps {
      open: boolean;
      onOpenChange(open: boolean): void;
      aiCategory: Category;
      subject: string | null;
      onPick(category: LabelCategory): void;
    }
    export function CategoryPicker(props: CategoryPickerProps): JSX.Element;
    ```

  - Decisions:
    - Buttons: shadcn `Button` `size="sm"` `variant="outline"` with the emoji as the only visible text (keys `act_icon_right`, `act_icon_edit`, `act_icon_undo` of stage 7; the `jsx-no-literals` rule flags a literal emoji) and an `aria-label`: `act_btn_right` with `{ category: categoryName(item.category) }`, `act_btn_edit`, `act_btn_undo`. ✅ is rendered only when `isLabelCategory(item.category)` (`@ea/core/web`): not for `unsure` and not for `delegation`, as in Telegram (`digest/notices.ts:16`; cold review finding 2). ↩️ is rendered only when `item.undoable`.
    - Pending: one `useState<"right" | "pick" | "undo" | null>`; while not `null` all three buttons of the mail are `disabled`.
    - ✅: `postFeedback({ emailId, trueCategory: item.category })`; the `isLabelCategory` guard of the render narrows `item.category` to `LabelCategory` (pass the narrowed value into the click handler). Success → `toast.success(feedbackToast("right", result, item.category))`; when `result.saved` → `onPatch(id, { feedback: { verdict: result.verdict, trueCategory: item.category, source: "web", at: new Date().toISOString() } })`.
    - ✏️: opens `CategoryPicker`; a pick → close, `postFeedback({ emailId, trueCategory: picked })` → `toast.success(feedbackToast("pick", result, picked))`; when saved → `onPatch` with `trueCategory: picked`, `verdict: result.verdict`.
    - ↩️: `postUndo({ emailId })` → `toast(undoToast(result.kind))` (`toast.success` for `started`, plain `toast` for the others); `started` → `onPatch(id, { undoable: false, undoPending: true })`; `already` → `onPatch(id, { undoable: false })`; `nothing`, `too_old`, `held` → no patch (the next poll shows the server state).
    - Errors: an `ApiError` with status 404 → `toast.error(t("err_not_found"))` and `onGone()`; any other error → `toast.error(t("error_generic"))`. A 401 never reaches here (`api()` sends the browser to `/login`).
    - `CategoryPicker`: a shadcn `Dialog` with `DialogTitle` `act_pick_title`, a line `act_pick_help` with `categoryName(aiCategory)`, the subject (`subjectText`) as a muted line, five `Button`s in `labelCategories` order with `categoryTagText(c)`; the AI category's button text is `act_pick_ai` with `{ category: categoryTagText(c) }`; a `Cancel` button (`cancel`). `labelCategories` comes from `@ea/core/web` (stage 1).
    - `ActivityRow`: the three text lines become one `button` (`type="button"`, full width, left aligned, `aria-haspopup="dialog"`) that calls `onOpen(item.emailId)` (new prop); `ActionButtons` sit under the text (a flex row), outside that button (no nested buttons).
    - `ActivityList` passes `patch` and `refresh` from `useActivityList` and keeps `selectedId` state for 9.2.
  - Test: none new in unit (the toast words have tests from stage 7); Playwright in stage 10.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run web:build`.
  - Done when: the checks pass.
  - Out of scope: the panel (9.2).

- [x] **9.2 `ActivityPanel` (A4, A7, B13)**
  - Goal: a tap on a row opens the details with the reason, the actions, the delegation, the feedback state and the same buttons.
  - Files: create `apps/web/src/components/activity/ActivityPanel.tsx`; change `ActivityList.tsx`.
  - Interfaces:

    ```tsx
    export interface ActivityPanelProps {
      item: ActivityItem | null; // null: closed
      timeZone: string;
      now: Date;
      mailboxAddress: string | null;
      onClose(): void;
      onPatch: ActionButtonsProps["onPatch"];
      onGone(): void;
    }
    export function ActivityPanel(props: ActivityPanelProps): JSX.Element;
    ```

  - Decisions:
    - `ActivityList` derives `const selected = state.items.find((i) => i.emailId === selectedId) ?? null` in render (S5c lesson 2); when the mail leaves the list (a filter-equal refresh, a removed mailbox), `selected` is `null` and the panel closes; `onClose` sets `selectedId` to `null`.
    - shadcn `Sheet` with `open={item !== null}`, `side={useMediaQuery("(min-width: 1024px)") ? "right" : "bottom"}`; the content `max-h-[85vh] overflow-y-auto` on the bottom side, `sm:max-w-md` on the right side; `SheetTitle` = `act_panel_title` (the accessible name), then the subject as a heading text.
    - Content order (A4): subject; `senderText(from)`, `act_received` with `formatClock`, the mailbox address when given; `categoryTagText(category)` `confidenceText(confidence)`; section `act_section_why`: `item.aiText ?? t("act_no_reason")` (a `whitespace-pre-line` paragraph; text only); section `act_section_did`: when `item.actions` is empty, `item.phrase`; else a list, one line per action: `act_action_at` with `{ phrase, time: formatClock(appliedAt) }` when `appliedAt`, else the phrase alone; an "Undo started" badge when `undoPending`; section `act_section_delegation` only when `item.delegation`: `delegationText` and, when `dueAt`, `act_dlg_due` with `formatClock(new Date(dueAt), timeZone, now)`; section `act_section_feedback`: `feedbackStateText(item.feedback)`; then `ActionButtons` (the same component, so the rules and the pending state are the same).
    - Focus: the Sheet traps focus and returns it to the row button on close (Radix default); Escape closes it.
  - Test: none new in unit; Playwright in stage 10 opens the panel in both projects (checks the "Not verified" item about the bottom sheet).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run web:build`. Hand check as in 8.2 (optional).
  - Done when: the checks pass; no `dangerouslySetInnerHTML` in `components/activity` (`grep -rn dangerouslySetInnerHTML apps/web/src/components/activity` finds nothing).
  - Out of scope: Playwright (stage 10).
