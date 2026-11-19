# F102 stage 17 review (Opus 5.5, PASS 7b0b53a1)

Model: Opus 5.5, because the stage has new Polish text and a web page (the owner reads Polish).

No BLOCKING. All 36 `dlg_*` keys and `title_delegates` exist in en and pl with matching placeholders, every key is used, no hard-coded string; plurals right ("10 tagów", "30 znaków"); axe clean on the page, the add form with errors, the edit dialog, the turn-off question, the member page, the suspended page and the flag-off page; keyboard-only flow works; focus stays on a moved row's switch in Chromium (probe, with and without reduced motion); member sees no form and a disabled switch; the full e2e suite (183 passed) is green; no migration, no `bun.lock` change; the shared limits keep their values; csp 20 pages.

Fixed in a Sonnet continue: TG1 (mutation e12: the general-error path keeps focus on Add; add the delayed-500 test), TG3 (after a "gone" answer the focused status div is empty because the text is in the `role="alert"` outside it: focus the alert or move the text), N2 (a notice when the list shows `DELEGATE_LIST_MAX` entries), N3 wording ("Każdy tag może mieć najwyżej {len} znaków"; `dlg_name` "Imię i nazwisko" as in `pl.ts:328`).

Open, carried:
- TG2: 400 `mailbox_address` is covered only by the unit test (the seeded organization has no mailbox); seed a mailbox address in the delegates organization to close it (stage 18 seed work).
- N1 (stage 18 before stage 20): `DelegationTabs` always renders the "Delegations" tab when the flag is on, and `/delegations` is a 404 until stage 18; the flag is on only in e2e seeds and lab organizations. Stage 18 must land before stage 20 turns the flag on for the pilot organization.
- Firefox and WebKit focus after a row moves is unverified (no Playwright project for them; the mobile project is Chromium emulation).
