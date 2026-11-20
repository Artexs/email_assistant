# F142 stage 02 — delegation compares addresses with the one rule

Part of [`../plan.md`](../plan.md). Review: `claude-sonnet-5-5` before the land.

Needs stage 01: `normalizeAddress` (`@ea/core`), `normalizedAddress` (`apps/server/src/platform/db`).
May run next to 03 and 04: it changes only `apps/server/src/modules/delegation/`, its tests and `docs/capabilities/delegation.md`.

## Step 1 — add a delegate (D5, D6)

- **Goal:** the delegate list holds each person once, by the rule.
- **Files:** `delegation/service.ts` (`addDelegate`), `delegation/repo.ts` (a new read).
- **Interfaces:** new repository read `findDelegateIdByAddress(db, ctx, address: string): Promise<string | undefined>`: `org_id` filter, any status, `normalizedAddress("email") = address`. `addDelegate` order stays: clean name → `normalizeAddress(input.email)` → address pattern → tags → mailbox check (`normalizeAddress(mailbox.address) === email`) → `findDelegateIdByAddress` hit returns `{ kind: "exists" }` → insert. The insert stores the rule form.
- **Decisions:** D6. The unique index still answers `exists` on a same-form race.
- **Test** (integration, the delegation service tests in `apps/server/test/integration/`):
  - 02-T1: add `İlker@Example.com` → `added`; the row holds `ilker@example.com`.
  - 02-T2: add `ΝΊΚΟΣ@example.gr` → stored `νίκοσ@example.gr` (the CHECK `email = lower(email)` holds on the job DB). This also checks the "Not verified" item of `plan.md`.
  - 02-T3: insert a row `νίκος@example.gr` directly (the old fold kept `ς`); add `ΝΊΚΟΣ@example.gr` → `exists`. Remove the pre-check: the add succeeds and the test fails.
  - 02-T4: a mailbox with address ` Boss@Example.com` (stored as given); add `boss@example.com` → `mailbox_address`.
  - 02-T5: org A has delegate `a@example.com`; org B adds `a@example.com` → `added` (tenant filter).
- **Done when:** 02-T1 to 02-T5 pass.

## Step 2 — find the delegate of a reply (D8)

- **Goal:** a reply from a delegate finds its open delegation whatever the case form of the From.
- **Files:** `delegation/repo.ts` (`findOpenDelegationByMessageIds`).
- **Interfaces:** signature unchanged. The compare is `normalizedAddress("g.email") = normalizeAddress(fromAddress)`.
- **Test:**
  - 02-T6: delegate stored `νίκος@example.gr` (old form), open delegation with `sent_message_id = <m1@example.gr>`; call with ids `["<m1@example.gr>"]` and from `ΝΊΚΟΣ@example.gr` → the delegation. Revert to `lower(g.email) = fromAddress.toLowerCase()`: no row, the test fails.
  - 02-T7: the same call with from `other@example.gr` → `undefined`.
- **Done when:** 02-T6 and 02-T7 pass.

## Step 3 — other folds in the module

Grep `toLowerCase`, `toLocaleLowerCase` and SQL `lower(` in `apps/server/src/modules/delegation/` (non-test files). An address fold moves to the rule. A fold of a non-address (tags) stays and gets the marker `// not an address: <reason>` on its line or the line before (plan D9), so stage 05 finds it clean. `docs/capabilities/delegation.md`: one line that the delegate address compares by the one rule and that a case-form duplicate is refused.

## Out of scope

The CLI argument parser of delegates (the service is the one place that folds). Loops. The repository file split (another ticket).

## Done when

Steps 1–3 done, then the Proof of `plan.md` with `NN=02` prints `PROOF_OK`. The result lists each guard (pre-check, reply compare), its removal and the failing test.
