# F102 stage 19 — Docs

Part of [`../plan.md`](../plan.md). Read every D and [`../commands.md`](../commands.md). Needs stages 01–18 landed. Docs only, in each file's style (about ASD-STE100). No real name, address or tailnet name.

## Step 1 — Capability pages (PD-009)

- **Goal:** the capability pages say what the panel and the API do now.
- **Files:** `docs/capabilities/web-panel.md`, `drafts-and-send.md`, `delegation.md`, `actions-and-undo.md`, `digest-and-notices.md`; each gets a new "Checked against the code at `<sha>`" line.
- **Decisions:**
  - `web-panel.md`: the three new pages and their flags in "What it does now" and rule 9; the new routers in the rule 7 table (`approvalRoutes`, `delegateRoutes`, `delegationRoutes`) with roles; `/api/openapi.json` and the route check; `approvalsWaiting` in `/api/me`; the phone tab rule (Q8); the entry points and tests. Remove the limits "No approvals, delegates or delegations page" and "no OpenAPI description".
  - `drafts-and-send.md`: approvals in the panel (approve, reject, edit, `via` `web`); the supersede rule (D1, D2) with the status reason `superseded`; the card sync (`approval_edit`, D4) and the panel line (D5); the 3000 and 200 limits; replace the limits that name F102. Add the edit to the approval flow diagram as one branch.
  - `delegation.md`: the pages, remind now (D9: its checks and why it skips the chaser's gates), cancel (`user_cancelled`, final), Done in the panel, `updateDelegate`; the new status edges in the flow block; remove the limits "No web page" and "No command changes the name … or the tags".
  - `actions-and-undo.md` § Data: `supersedes_action_id`, the reason `superseded` in the status flow, the payload fields `version`, `subject_text`, `body_text`.
  - `digest-and-notices.md`: the notice kind `approval_edit` (edits skip quiet hours, `answered_elsewhere`, `edit_failed`, `no_target`).
- **Test:**
  - T1: `docs/capabilities/web-panel.md` names `approvalRoutes`, `delegateRoutes`, `delegationRoutes` and `/api/openapi.json`.
  - T2: `docs/capabilities/drafts-and-send.md` names `superseded` and `approval_edit`.
  - T3: no capability page holds `E4-A (F102)` in its Limits (this check must find nothing).
- **Done when:** T1–T3 hold; prettier passes on the five files.

## Step 2 — ADR 0023, architecture, patterns

- **Goal:** the decision record and the rules for later work are true.
- **Files:** `docs/decisions/0023-user-commands-openapi-contract.md`, `docs/architecture.md`, `docs/modules.md`, `docs/code-patterns.md`.
- **Decisions:**
  - ADR 0023: status `accepted (PD-035, F102)`; add `## Amendment (F102, <land date of stage 03>)`: `hono-openapi` 1.6.0 (exact pin), the `apiDoc` helper, `describeRoute` only (its `validator` answers another 400 shape), the hidden routes and why (E10 publishes the file), the route test.
  - `docs/architecture.md`: the approval section gets the panel channel, the edit as a superseding row and the card sync, in the flow text that describes approvals (one short paragraph; no history).
  - `docs/modules.md`: the new routers per module and the new pages per slice.
  - `docs/code-patterns.md` § "Add an action type or a draft kind": one line that an edited draft is a superseding row (never a payload change); and a short new list "Add a user command": a service function with `via`, a route with `apiDoc` and the schemas in `@ea/core/web`, the role check, a flag while new, the card hooks when it decides a send.
- **Test:**
  - T4: the ADR has exactly one line that starts `## Amendment (F102`.
  - T5: `docs/code-patterns.md` holds `Add a user command` once.
- **Done when:** T4, T5 hold; prettier passes on the four files.

## Done when (stage)

- Steps 1 and 2 hold; one commit per step. The Proof prints `PROOF_OK`:

```
mkdir -p /tmp/f102-s19 && bunx prettier --check <the nine files> > /tmp/f102-s19/prettier.log 2>&1 && bun run lint > /tmp/f102-s19/lint.log 2>&1 && bun run test:unit:ci > /tmp/f102-s19/unit.log 2>&1 && echo PROOF_OK
```

## Carry-over from stage 10 review

- `docs/capabilities/tenancy-and-plans.md` line 32 says `approvals_page` has one reader, the panel link on the approval card. Now the approvals read routes and the `/api/me` badge read it too. Update the line.

## Carry-over from stage 14 review

- Document the three `/api/delegates` routes and the `delegation_pages` flag in `docs/capabilities/delegation.md` and `tenancy-and-plans.md`. `delegate.changed` audit data holds `fields` as a comma string (flat audit data); the CLI enable/disable audit row now has `fields:"active"` and `via:"cli"` (see review-14.md).

## Carry-over from stage 16 review

- Add the audit event `delegation.remind_requested` to the audit lists in `docs/capabilities/delegation.md`, the `audit_log` row in `docs/architecture.md` and `docs/modules.md`; the chaser text (rule 8, "3 days apart") needs the remind-now exception: remind-now has no gap rule and sets `last_reminder_at` at planning, as the chaser does (review-16.md N4, N7).

## Carry-over from stage 18 re-review (PASS aea56cf9)

- N-focus: track `focusout` too (clear the focused-row ref when `relatedTarget` is null), so a later reload does not move focus to the status line without a user action.
- N-pl: optional wording for `dgn_moved`: "To zlecenie zmieniło stan i nie ma go już na tej liście." (the page has no "karta"); keep en and pl in step.
- Docs (capability page): Remind now stays visible with `aria-disabled` and a reason; the cancel question keeps its item after a reload.
