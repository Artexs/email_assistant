# Items for the one visual review (collected by the coordinator, 2026-11-25)

- Dark mode: the `soft` button and default badge hover (`hover:bg-primary-soft/70`) fails axe colour contrast when the mouse rests on a soft button during a scan (approvals e2e `S13-T8` desktop fails in 2 of 4 runs; same class on master before the stock sweep). Fix the hover colour in `button.tsx` and `badge.tsx`.
- `account.spec.ts:54` fails with `page.goto: net::ERR_ABORTED` on `/login` in 4 of 6 isolated runs, also before the stock sweep. A load flake of the sign-in page redirect; find why `/login` aborts.
- Polish Settings on desktop: the chip "Podsumowania i powiadomienia" touches the section label by about 4 px.
- The wait select squeezes its label on a phone (Settings, Polish).
- Focused buttons can sit under the phone tab bar on pages other than Open loops: no shell-wide `scroll-padding-bottom` for the tab bar.
- Report page: sidebar highlights Settings; amber "already on" notice right after a successful tap; summary "Mails checked: 0" next to cards with 200.
- Docs page `explanation/never-sends-alone.mdx:43` names the notice "Sends held", which does not exist.
- Hash scroll to `#organization` and `#account`; non-owner on a phone loses the lead line; loading, error and gone-mailbox states of Stats have no spec; F170 stage 04 shows one card per topic where the mockup has rows in one card; delete-card edge uses a solid destructive colour.
