---
opened: 2026-11-15
---

# F127 · the two-factor text in the Account card renders as one word per line

## Outcome

An alert text in the web panel fills the width of its box. Today the text "Twoja rola wymaga logowania dwuetapowego: bez niego konsola operatora się nie otworzy." in Settings, Account, Two-factor sign-in shows one word per line (screenshot: `evidence/account-card-alert-one-word-per-line.png`, from the owner, 2026-11-15). A new test or lint rule stops the same fault from coming back.

## Scope

- Cause (read from the code at `0ceaa71e`, not yet reproduced in a browser): `Alert` in `apps/web/src/components/ui/alert.tsx` is a grid with `grid-cols-[0_1fr]` and no icon. A bare text child goes into the first column, which is 0 wide plus the gap. `AlertDescription` and `AlertTitle` put their text in column 2 (`col-start-2`), so they work.
- Bare-text `<Alert>` uses found by grep: `apps/web/src/components/settings/TwoFactorSection.tsx` (the `tf_required_operator` and `tf_required_break_glass` alert, and the `tf_codes_few` / `tf_on_without_codes` alert) and `apps/web/src/islands/LoginPage.tsx` (the `login_setup_done` alert). Check every `<Alert` in `apps/web/src` (also `OnboardingPage.tsx`, `MailboxCard.tsx`).
- Fix the cause once, in the `Alert` component or by wrapping the texts in `AlertDescription`. Prefer the component fix, so a new bare-text alert cannot break.

## Out of scope

- Changing any text, any Polish wording or the alert colours.
- A visual redesign of the Account card.

## Acceptance

- In a real browser at desktop and phone width, the two-factor alert text, the "few backup codes" alert and the login "setup done" alert fill the box width (no word-per-line column). A Playwright check asserts that the alert text box is at least half as wide as the alert box.
- A test or lint rule fails when an `Alert` renders a bare text child and the layout collapses (or the `Alert` component handles it, and a test shows the collapse is gone).
- A screenshot of the fixed Account card is in the final message.

## Notes

- The fault came in with F105 stage 11 (the account section). Its unit tests have no DOM, and its e2e did not look at layout. Stage 12's e2e and F106 stage 11's "no empty block" test did not catch it.
- Small ticket: one stage is enough. A Sonnet worker builds it. No migration, no new text.
