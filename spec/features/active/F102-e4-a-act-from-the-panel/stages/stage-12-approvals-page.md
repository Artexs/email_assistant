# F102 stage 12 — Approvals page

Part of [`../plan.md`](../plan.md). Read P2, P5, P6, D5, D11, D13, Q1, Q8, Q13 and [`../commands.md`](../commands.md). Needs stages 07 and 11 landed. New Polish text: the review uses `claude-opus-5-5`.

## Step 1 — Nav, page, list and detail

- **Goal:** with `approvals_page` on, a member sees every waiting draft and opens one by link.
- **Files:** a new page `apps/web/src/pages/approvals.astro`, a new island `ApprovalsPage.tsx` and components under `apps/web/src/components/approvals/`, an API helper in `apps/web/src/lib/`, `nav-items.ts` and `Nav.tsx`, `en.ts` and `pl.ts`, unit tests.
- **Decisions:**
  - Nav (D11, Q8): item `approvals` (`/approvals`, label `nav_approvals`) after Activity while `features` holds `approvals_page`, with a count badge from `me.approvalsWaiting` (hidden at 0; "99+" above 99; accessible name `nav_approvals_badge` "{n} waiting"). Phone tabs: at most 5; the order is Activity, Approvals, Delegations, Mailboxes, Settings, Rules, Stats, and items past 5 show in the user menu on the phone. Stage 18 adds Delegations to the same order. The desktop sidebar shows all.
  - Page: the list (`GET /api/approvals`) and a detail panel for the selected item (`GET /api/approvals/<id>`). The selection is the `id` query parameter (Q1): `/approvals?id=<uuid>` opens that item, also when it is no longer in the list. A `superseded` detail shows "Changed. This is the newest version." and loads `currentId` (`replace` the URL).
  - The list reloads every 30 s while the tab is visible.
  - An item shows what the Telegram card shows (title by kind, recipient spelled out, `(inactive)`, subject, external-sender warning, due date), plus "expires in", "Preparing the draft…" while `draftReady` is false, the held reason, "Version n" for n ≥ 2, and "The system sends it after your approval. Do not send the draft from your mail client." The detail adds the body and the full quote (plain text, line breaks kept).
  - Empty list: "Nothing waits for your approval."
- **Test** (unit): T1: the nav order and the 5-tab limit for each combination of `approvals_page` and `stats_page`; T2: the badge text for 0, 1, 100; T3: the state-to-label map covers every `ApprovalDetail.state`.
- **Done when:** T1–T3 pass; `bun run typecheck` passes (every key in both languages).

## Step 2 — Approve, reject, reason; e2e

- **Goal:** an owner approves or rejects from the page; a member only reads.
- **Files:** the components of Step 1, the e2e seed (`apps/server/src/scripts/e2e-seed.ts` or a new seed beside it; output through its `createCliOutput`, ids only: one organization with a waiting delegation send whose draft is applied, a held send, and a member), a new `apps/web/e2e/tests/approvals.spec.ts`.
- **Decisions:**
  - Buttons Approve and Reject for an owner (`canWrite` and the role), only Reject for `held`, none for a member and for other states. One request at a time per item; buttons are disabled while it runs.
  - Answers: `approved` → "Approved, sending."; `approved_held` → the `heldBy` text; 409 `changed` → load `currentId` with "This draft was changed. Check the new version."; 409 `draft_not_ready`, `closed` → a short text and a reload; others → the existing error banner.
  - After Reject, while `mistake_capture` is on: the optional select "Why?" with wrong person, wrong content, not needed, and Skip (P5; the existing reject-reason route).
- **Test** (e2e, `desktop` and `mobile`):
  - T4: flag on → the nav shows Approvals with badge `1`; flag off → no item, and `/approvals` shows the flag-off text.
  - T5: `/approvals?id=<seed send>` shows `Anna Nowak <anna@example.com>`, the subject, the body, the quote and the external-sender warning.
  - T6: Approve → "Approved, sending."; the item leaves the list after the reload; the badge shows no number.
  - T7: Reject on the second seed send → the reason select; "Wrong person" saves (no error).
  - T8: the member sees the list and no Approve or Reject button.
  - T9: `expectNoA11yViolations` on the list and on the open detail, both projects.
  - T10: on `mobile` with `approvals_page` and `stats_page` on, the tab bar has 5 tabs and Stats is in the user menu.
- **Done when:** T4–T10 pass; the full e2e suite passes.

## Done when (stage)

- Steps 1 and 2 hold. The web Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s12`); `web.log` shows `csp checked in <n> page(s)` (n: one more than on `master` before; name both).
