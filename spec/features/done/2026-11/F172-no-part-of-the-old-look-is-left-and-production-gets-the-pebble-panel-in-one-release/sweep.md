# Stock class sweep: what was kept, what was removed

One-time sweep of `components/`, `islands/` and `layouts/` in `apps/web/src/`. A hit that stays has a reason. The guard in `lib/token-classes.test.ts` covers stock and arbitrary shadows; the rest is by eye.

## Stage 01 list

Stage 01 left no entry. No file keeps a guard exception for an unused file, token or emoji.

## Shadows

- `components/ui/button.tsx` `shadow-[…]` became `shadow-button` (new token `--shadow-button`).
- `components/patterns/StickyActions.tsx` `shadow-[…]` became `shadow-bar` (new token `--shadow-bar`).
- `components/ui/select.tsx` `shadow-md` became `shadow-card` (the design system has no overlay shadow).
- No bare `shadow` class exists in source. The word appears only as the mode value and in comments.

## Controls under 44 px

Fixed:

- `components/approvals/QueueHead.tsx`: two buttons of size `xs` became `sm` (44 px).
- `components/settings/DigestTimesCard.tsx`: the time input `h-9` became `h-11`; the remove button `icon-xs` became `icon-sm`.

Kept:

- `components/operator/OrgTable.tsx` `h-9` row and `xs` buttons: a dense table (ADR 0037 decision 3).
- `components/ui/table.tsx` `h-9` head cell: a dense table.
- `components/ui/button.tsx` `xs` (`h-9`): used only by `OrgTable.tsx` (dense table).
- `components/ui/select.tsx` `data-[size=sm]:h-9`: used only by `components/operator/NoticeList.tsx` (operator console).
- `components/ui/input.tsx` `file:h-8`: the button inside a file input, not a control of its own.
- `components/onboarding/ChecklistItem.tsx` `size-9`, `components/patterns/SectionCard.tsx` `size-9`, `components/patterns/InitialsAvatar.tsx` `size-8`, `components/shell/BrandMark.tsx` `size-8`/`size-9`, `components/patterns/EmptyState.tsx` `after:size-8`: pictures and tiles with no action.
- `islands/StatsPage.tsx` `h-8`: skeleton lines, not controls.

## Large text outside `PageHead` and `AuthCard`

- `text-3xl` in `components/patterns/StatTile.tsx`, `components/onboarding/ProgressCard.tsx` and `components/stats/StatsHead.tsx`: a figure (a number in a tile or ring), not a title. The scale holds `text-3xl`.
- `text-2xl` appears only in `PageHead.tsx` and `AuthCard.tsx`.

## Arbitrary pixel values

Fixed to a scale value: `ring-[3px]` to `ring-3`, `size-[18px]` to `size-4.5`, `p-[3px]` to `p-0.75`, `translate-y-[2px]` to `translate-y-0.5`, `lg:mb-[22px]` to `lg:mb-5.5`, `rounded-[10px]` to `rounded-sm`, `max-w-[400px]` to `max-w-100`, `rounded-[2px]` to `rounded-xs`.

Kept (no scale value): `rounded-[32px]` (`AuthCard.tsx`), `rounded-[14px]` (`InitialsAvatar.tsx`), `rounded-[3px]` (`StepDots.tsx`), `max-[359px]` (`Row.tsx`, a width break below the scale), and the `data-[…]` selectors of Radix.

## Variants and sizes removed

Searched with the compiler: each key was removed from the type, and the errors named the users.

- `Badge` variants `ghost`, `link`: no user.
- `Button` sizes `icon-lg` (no user) and `icon-xs` (its one user moved to `icon-sm`).
- `TabsList` variant `line`: only the pattern page used it. `TabsList` has no variant prop now. `tabs.tsx` stays (only the pattern page imports it).
- Every other `Button` variant and size, the `Alert` variants and the `Badge` variants `default`, `secondary`, `outline`, `destructive` have users.

## Dependency

`next-themes` had no reader (searched all of `apps`, `packages`, `docs`). It is removed from `apps/web/package.json` and `bun.lock`.
