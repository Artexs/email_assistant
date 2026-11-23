# F167 stage 04 — Shell parts: banners, terms dialog, "what is new" card, placeholder

Part of [`../plan.md`](../plan.md). Needs F166 stage 03: the tokens `bg-destructive-soft`, `text-destructive`, `bg-accent`, `text-accent-foreground`, radius `lg`, `shadow-card` (and its class changes in the two banner files). Needs F166 stage 08: `web:build:dev` (the Proof). May run next to 01, 02, 03, 05, 06, 07. The restyled `Dialog` and `Card` (F166 stages 04 and 05) are not a need: until they land, the pictures show the old primitives.

This stage owns `AuthErrorBanner.tsx`, `PausedBanner.tsx`, `TrialLine.tsx`, `TermsDialog.tsx`, `WhatsNew.tsx` and `Placeholder.tsx` in `components/shell/`. It does not edit `AppShell.tsx` or `Nav.tsx` (stage 02 places these parts; D7 of `../plan.md`).

## Step 1 — Banners and the trial line

- **Decisions:** D2, D14. Each banner is a rounded box (radius `md`), no outer margin (stage 02 places it), 16 px text, an icon at the start (`aria-hidden`), `role="status"` kept.
  - `AuthErrorBanner` (a mailbox login failed): the warm warning look, `bg-accent text-accent-foreground` (F166 D13 allows `accent` for the warning banner), icon `TriangleAlert`; the link to `/mailboxes` keeps its text and is underlined and bold.
  - `PausedBanner` (the organization is suspended): `bg-destructive-soft text-destructive`, icon `CirclePause`.
  - `TrialLine`: a plain line in `text-muted-foreground` with icon `Clock`; it is not a banner (no box, no role), as today.
- **Edge cases:** a long Polish text wraps inside the box at 320 px; the plural forms of `auth_error_banner` (1, 2, 5) keep their `tp` keys; with both banners on, each keeps its own role.

## Step 2 — Terms dialog, "what is new" card, placeholder

- **Terms dialog:** the look of the restyled `Dialog` primitive (F166 owns it); inside, the legal links as a row of soft links in `text-primary`, the accept button full width below `lg`, the log out button `ghost`. Behaviour stays: no close by Escape or a click outside, the error line with `role="alert"`, the links with `target` and `rel` as today.
- **"What is new" card:** a `Card` (radius `lg`, `shadow-card`), title `h2` as today with `id="whats-new-title"`, an icon tile in `bg-primary-soft text-primary` (the mockup `.sec` tile), the list, the link in `text-primary` bold, the dismiss button `icon-sm` ghost with its `aria-label`. No outer margin. `HelpLink` keeps its signature `({ className })`: stage 02 passes the class for the sidebar.
- **Placeholder:** the card with `text-muted-foreground`, no change beyond tokens.

## Step 3 — Capability page

`docs/capabilities/web-panel.md` rule 9, the banner sentence only (D16): it says how each one looks and that each keeps `role="status"`.

## Test

1. `whats-new-card.test.tsx` passes unchanged in its texts, hrefs, `rel` and `aria-label` assertions; add: the card root has no `mx-` or `mt-` class.
2. A render test of `AuthErrorBanner` with `count` 2: `role="status"`, the `en` plural text for 2, the link `href="/mailboxes"`, and the class `bg-accent`. With `count` 0: renders nothing.
3. A render test of `PausedBanner` with `contact` `null` and with `"ops@example.com"`: `role="status"`, the two texts, the class `bg-destructive-soft`.
4. e2e `terms.spec.ts`, `plan.spec.ts` and `docs-links.spec.ts` pass unchanged.
5. e2e in `plan.spec.ts` (suspended organization of the seed): the a11y scan passes with the paused banner shown, on both projects.

## Out of scope

Where the banners sit in the frame (stage 02). The `Dialog` and `Card` primitives (F166). The removal of the "what is new" card (F172).

## Done when

You opened `activity` in the contact sheet for the organization states that show a banner (suspended, trial, mailbox in auth error, if the sheet has them) in both schemes and both languages; the Proof of `../plan.md` with the specs `terms.spec.ts plan.spec.ts docs-links.spec.ts auth.spec.ts` prints `PROOF_OK`.
