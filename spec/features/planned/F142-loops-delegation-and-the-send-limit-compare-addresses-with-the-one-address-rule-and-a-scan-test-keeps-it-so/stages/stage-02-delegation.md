# F142 stage 02 — delegation compares addresses with the one rule

Part of [`../plan.md`](../plan.md). Review: `claude-sonnet-5-5` before the land.

Needs stage 01: `normalizeAddress`, `storedAddressForm` (`@ea/core`); `normalizedAddress` (`apps/server/src/platform/db`).
May run next to 03 and 04: it changes only `apps/server/src/modules/delegation/`, its tests and `docs/capabilities/delegation.md`.

## Step 1 — add a delegate (D5, D6)

- **Goal:** the delegate list holds each person once, by the rule; the stored address stays the one reminders go to.
- **Files:** `delegation/service.ts` (`addDelegate`), `delegation/repo.ts` (a new read).
- **Interfaces:** new repository read `findDelegateIdByAddress(db, ctx, address: string): Promise<string | undefined>`: `org_id` filter, any status, `normalizedAddress("email") = normalizeAddress(address)`. `addDelegate` order: clean name → `storedAddressForm(input.email)` → address pattern → tags → mailbox check (`normalizeAddress(mailbox.address) === normalizeAddress(email)`) → `findDelegateIdByAddress` hit returns `{ kind: "exists" }` → insert the stored form.
- **Decisions:** D5 (never store the rule form), D6.
- **Test** (integration, the delegation service tests in `apps/server/test/integration/`):
  - 02-T1 pin: add `İlker@Example.com` → `added`; the row holds `storedAddressForm` of it (`i` + U+0307 + `lker@example.com`), not `ilker@example.com`.
  - 02-T2 pin: add `ΝΊΚΟΣ@example.gr` → stored `νίκος@example.gr` (the CHECK `email = lower(email)` holds on the job DB).
  - 02-T3 guard: after 02-T1, add `ilker@example.com` → `exists`. The base code adds a second row.
  - 02-T4 guard: after 02-T2, add `νίκοσ@example.gr` → `exists`.
  - 02-T5 guard: a mailbox with address `İlker@Example.com`; add `ilker@example.com` → `mailbox_address`. The base code adds it.
  - 02-T6 pin: org A has delegate `a@example.com`; org B adds `a@example.com` → `added`.
- **Done when:** 02-T1 to 02-T6 pass; removing the pre-check fails 02-T3 and 02-T4.

## Step 2 — find the delegate of a reply (D8)

- **Goal:** a reply from a delegate finds its open delegation whatever the case form of the From.
- **Files:** `delegation/repo.ts` (`findOpenDelegationByMessageIds`). Signature unchanged. The compare is `normalizedAddress("g.email") = normalizeAddress(fromAddress)`.
- **Test:**
  - 02-T7 guard: delegate added through `addDelegate` as `İlker@Example.com`; an open delegation with `sent_message_id = <m1@example.com>`; call with ids `["<m1@example.com>"]` and From `ilker@example.com` → that delegation. Reverted to `lower(g.email) = fromAddress.toLowerCase()` → `undefined`.
  - 02-T8 guard: delegate stored `νίκοσ@example.gr` (insert the row directly: an address typed with a plain sigma); From `ΝΊΚΟΣ@example.gr` → the delegation. Reverted → `undefined`.
  - 02-T9 pin: From `other@example.com` → `undefined`.
- **Done when:** 02-T7 to 02-T9 pass.

## Step 3 — other folds in the module, page

Grep `toLowerCase`, `toLocaleLowerCase`, `lower(`, `upper(` and `ilike` in the non-test files of `apps/server/src/modules/delegation/`. An address fold moves to the rule (compare) or to `storedAddressForm` (write). A non-address fold (tags) gets `// not an address: <reason>` on its line or the line before (plan D9). `docs/capabilities/delegation.md`: one line that delegate addresses compare by the one rule and that a case-form duplicate is refused.

## Out of scope

The delegates CLI argument parser (the service folds). Loops. The delegation repository split (another ticket).

## Done when

Steps 1–3 done, then the Proof of `plan.md` with `NN=02` prints `PROOF_OK`. The result lists each guard, its removal and the failing test.
