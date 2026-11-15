# F102 stage 17 — Delegates page

Part of [`../plan.md`](../plan.md). Read P4, P6, D10, D11, D13 and [`../commands.md`](../commands.md). Needs stages 07 and 14 landed. New Polish text: the review uses `claude-opus-5-5`.

Two steps in `apps/web`.

## Step 1 — The page

- **Goal:** with `delegation_pages` on, an owner adds, changes, disables and enables delegates in the panel; a member reads the list.
- **Files:** a new page `apps/web/src/pages/delegates.astro`, a new island `DelegatesPage.tsx`, components under `apps/web/src/components/delegation/`, an API helper in `apps/web/src/lib/`, `en.ts` and `pl.ts`, unit tests.
- **Decisions:**
  - D11: `/delegates` is not a nav item. A header tab bar with two links, "Delegations" (`/delegations`) and "Delegates" (`/delegates`), sits on both pages; this stage builds the shared header and stage 18 uses it. While the flag is off the page shows the flag-off text, as Stats does.
  - List: name, address, tags as small badges, and the state (Active or Off). Active first, then by name (the server order).
  - Add (owner): a form with Name, E-mail and Tags (comma-separated; the form splits, trims and drops empty parts). Answers: 201 → the row appears; 409 `exists` → "This address is already a delegate."; 400 `mailbox_address` → "This is the address of one of your mailboxes."; 400 `validation` → the field error.
  - Change (owner): an Edit dialog with Name and Tags only; the address shows read only with "To use another address, add a new delegate." (D10). A switch per row turns the delegate on or off at once (`PATCH { active }`); turning off asks "Turn off <name>? Open delegations stay; new mail is not delegated to them."
  - A member and a suspended organization (`canWrite`) see no form, no Edit and a disabled switch.
- **Test** (unit):
  - T1: the tag field `"finance, Budget ,, it"` gives `["finance", "budget", "it"]`.
  - T2: the answer map gives the texts above for 409 `exists` and 400 `mailbox_address`.
- **Done when:** T1, T2 pass; the typecheck passes.

## Step 2 — e2e

- **Goal:** the page works end to end on both projects.
- **Files:** a new `apps/web/e2e/tests/delegates.spec.ts`; the e2e seed (the flag on for the seed organization, delegate Anna Nowak `anna@example.com` with tag `finance`, a member user).
- **Test** (e2e, `desktop` and `mobile`):
  - T3: the header tabs show "Delegations" and "Delegates"; "Delegates" is the current page (`aria-current="page"`).
  - T4: add `Piotr Lis`, `piotr@example.com`, tags `it` → the row appears; add the same address again → the `exists` text.
  - T5: edit Anna's name to `Anna Nowak-Lis` → the list shows the new name.
  - T6: turn Piotr off and confirm → the state shows Off; turn him on → Active.
  - T7: the member sees the list and no Add form.
  - T8: with the flag off, `/delegates` shows the flag-off text.
  - T9: `expectNoA11yViolations` on the page, with the add form, and with the Edit dialog open.
- **Done when:** T3–T9 pass; the full e2e suite passes.

## Done when (stage)

- Steps 1 and 2 hold. The web Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s17`); `web.log` shows `csp checked in <n> page(s)` with n one more than on `master` before the stage; the final message names both.
