# F102 · E4-A Act from the panel: plan

> **Status 2026-11-15 — planned.** Plan base: 5e07cdf2. 20 stages; nothing built. Drift check and refresh before stage 01 (F101 is in build).

Ticket: [ticket.md](ticket.md). Defaults: [questions.md](questions.md). Interfaces: [commands.md](commands.md). Sources: the E04 epic page and discovery notes, `06-architecture-review.md` §3.8, ADR 0023.

## Input

Owner (PD-029–PD-036): "The rest is fine. Use the default values." Job (2026-11-15): "Owner checkpoints and owner steps are not a stop: use plan defaults."

### Product decisions (do not reopen)

- **P1 (PD-029)** E4-A = command contract, approvals with edit, delegates, delegation dashboard, axe on every page, Telegram card sync (F039), the panel half of F075. Not here: E4-B, style text and mail-client edits (E6), manual delegation (E5b).
- **P2 (PD-031)** Telegram and the panel both approve. Edit only in the panel, only while `awaiting_approval`. An edit is a new version that replaces the Drafts copy and needs a new tap. No free-text recipient: pick another delegate.
- **P3 (PD-035)** Every user action is a typed `/api` route in OpenAPI (ADR 0023). Axe WCAG 2.2 A/AA, zero violations, on every panel page; a keyboard test for approvals.
- **P4 (PD-045)** New pages behind flags, default off: `approvals_page` (exists), `delegation_pages` (new, epic `E4-A`, remove-by 2027-03-01).
- **P5 (PD-057)** After a panel reject, the optional reason select uses `POST /api/actions/:id/reject-reason` (flag `mistake_capture`).
- **P6** Owner only: approve, reject, edit, remind, cancel, delegate writes. Any member: reads and Done (as Telegram `dd:`). Q7.

### Design decisions

- **D1 Edit = supersede** (review §3.8 decision 4). One transaction, no outside call: a new `create_draft` (`ready`) and a new `send` (`awaiting_approval`, depends on it), each with `supersedes_action_id` = the old row; keys `<old id>:edit`. The old send → `expired`, `status_reason = superseded`, `result_notified_at` = now (no result notice). The old draft closes by `closeDraftOfSend` with reason `superseded`. The delegation keeps its status; hook `onSuperseded` moves `draft_action_id`, `send_action_id`, `delegate_id`. Rejected: change the payload in place plus a hash (versions, Drafts copy and new tap would need new rules).
- **D2 Version binding.** Each command names the send id that the page shows. A superseded id → 409 `changed` with `currentId`. A Telegram tap on an old card → "changed" answer. No text hash here (PD-076 is E6a).
- **D3 Edit content.** `subject` 1–200, `body` 1–3000 characters after `cleanUserText` (CRLF → LF; drop control characters except `\n`, `\t`; drop bidi controls; trim line ends); the subject is one line. Optional `delegateId` (kind `delegation`; active; not the current one). The quote stays system-made. Draft payload adds `version` (absent = 1), `subject_text`, `body_text`. Kind `reminder`: 400 `not_editable` (Q2). Same text and delegate: 400 `unchanged`.
- **D4 Card sync.** Outbox kind `approval_edit`; column `outbox.edit_of_outbox_id`. Queued in the decision's transaction for every sent `approval:<send id>` card except the tapped one; view = the edit input with the card's stored text. A `pending` card → `failed` / `answered_elsewhere`; a `sending` card gets no edit (accepted: its tap answers right). Edits skip quiet hours; an edit error → `failed`, no retry. Outcomes: `approved`, `approved_held`, `rejected`, new `changed`. `actions` reaches `channels` only through `ApprovalHooks.onDecided` (layers).
- **D5 Panel link.** Approval view gains optional `version` and `panelUrl` (24 h view rule). `panelUrl` = `<WEB_BASE_URL>/approvals?id=<send id>` when the flag is on and the base URL is set. A text line, not a URL button (Q1).
- **D6 OpenAPI.** `hono-openapi` 1.6.0, exact pin, `apps/server` only. Only `describeRoute`, never its `validator` (F1). `GET /api/openapi.json` behind login. Hidden: operator routes, `/api/auth/*` (E10). Unit test `openapi-routes.test.ts`: every `apiRouters` route is in the spec or in `HIDDEN_ROUTES` with a reason.
- **D7 Commands**, roles and answers: [commands.md](commands.md).
- **D8 Read model** in `channels` (it needs `delegation`, `config`; layers), from `approvalViewFor` (the committer's builder) plus the full quote. `expiresAt` = `notified_at` + 48 h, else `created_at` + 7 days.
- **D9 Delegations.** Remind now: `sent` or `overdue`, `reminders_sent` < 2, no waiting reminder (checked under the delegation lock: the dedup), `assist` with `create_draft` on (else 409 `drafts_off`); no due-date or 3-day gate; no set. Cancel: `drafted` → reject its send (with card edits; `applying` → 409 `sending`); `sent` or `overdue` → `cancelled` / `user_cancelled`, waiting reminders expire. Done: `closeDelegation`.
- **D10 Delegates.** Add, and PATCH name, tags, active. The address never changes.
- **D11 Nav.** Badge = `/api/me` `approvalsWaiting` (sends `awaiting_approval` with an `applied` draft; 0 with the flag off). Phone: at most 5 tabs (Q8). Delegates is a header tab of `/delegations`.
- **D12 Superseded rows.** Activity and digest phrase "changed in the panel"; no metric counts them (PD-057).
- **D13 Axe.** `@axe-core/playwright` (exact pin), `expectNoA11yViolations(page)`, WCAG 2.0–2.2 A and AA tags.
- **D14** One migration (stage 06); `bun.lock` only in stages 01 and 07.
- **D15** `ApprovalInput.via` adds `web` (audit `data.via`, `approved_via`).

## Facts checked (2026-11-15)

- **F1** Probe, `hono-openapi` 1.6.0, `hono` 4.13.16, `zod` 4.1.12: async `generateSpecs` walks nested routers; it omits an undescribed route silently, and a `hide: true` route; `describeRoute` after a middleware and `requestBody` with `resolver` work; its `validator` answers its own 400 shape.
- **F2** `@axe-core/playwright` 4.14.0 needs `playwright-core >=1.0.0` (npm).
- **F3** `renderTemplate` takes no delegate name: a new delegate changes only `to` and the names.
- **F4** `approve` checks the 48 h limit only with `notified_at` set: a panel approval works with no Telegram link (`actions/approvals.ts`).
- **F5** A draft APPEND that ends after its sends closed removes the copy (`actions/drafts.ts`); supersede inherits this.
- **F6** Outbox rows keep `external_message_id` and the sent text; `ChatChannel.edit` exists.
- **F7** The phone tab bar has 4 or 5 columns (`Nav.tsx`). A path with no file gets the 404 page; `/approvals?id=` needs no server change.

## Not verified

- **N1** Telegram edit of an old card: stage 09 maps an error to `failed` / `edit_failed`.
- **N2** Axe violations of the existing pages: stage 07 counts them.
- **N3** Every existing route shape in `hono-openapi`: stages 01–03.
- **N4** The panel on the phone: U1.

## Done when

1. `/api/openapi.json` lists every non-hidden route; the route test passes.
2. Panel edit, approve and reject work; the Telegram cards follow (stages 08–13).
3. The delegates and delegations pages work (stages 14–18).
4. Every e2e spec has zero axe violations; the keyboard test passes.
5. Each Proof prints `PROOF_OK`; the stage 20 checks hold.

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, the ticket, this file, `commands.md` and your stage.
- Format only your files. Commit by explicit path after `git diff --staged`.
- Never log, or put in an error text or test name, mail text, draft text, subjects or addresses.
- New page keys in `en.ts` and `pl.ts`; new notice and bot texts in `packages/core/src/texts/` (en, pl).
- A new `/api` route gets `apiDoc` in the same commit (D6).
- A gap or deviation is a question in the final message, not a choice.

## Proof

Server and core stages:

```
mkdir -p /tmp/f102-sNN && bun run lint > /tmp/f102-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f102-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f102-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f102-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (07, 12, 13, 17, 18) add before `echo PROOF_OK`: `&& bun run web:build > /tmp/f102-sNN/web.log 2>&1 && grep -q 'csp checked in' /tmp/f102-sNN/web.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f102-sNN/e2e.log 2>&1`. Own e2e DB first (F101 stage 02 Step 3, name `f102_sNN_e2e`). Never `web:dev`.

## Owner steps

- **U1** After stage 20: a 10-minute phone test (approve one draft in the panel, one in Telegram). Not a stop.

## Review

Before land, `claude-opus-5-5`: 06, 08, 09, 11, 16 (migration, exactly-once, sending, auth) and 05, 12, 13, 17, 18 (Polish text). `claude-sonnet-5-5`: 01.

## Stages

- 01 [OpenAPI frame](stages/stage-01-openapi-frame.md) (`bun.lock`)
- 02 [Describe routes A](stages/stage-02-describe-routes-a.md); needs 01
- 03 [Describe routes B](stages/stage-03-describe-routes-b.md); needs 02
- 04 [Edited draft payload](stages/stage-04-edited-draft-payload.md)
- 05 [Card texts](stages/stage-05-card-texts.md); needs 04
- 06 [Migration](stages/stage-06-migration.md) `[risky]`
- 07 [Axe frame](stages/stage-07-axe-frame.md) (`bun.lock`); needs 01, F101 done
- 08 [Supersede](stages/stage-08-supersede.md) `[risky]`; needs 04, 06
- 09 [Card sync](stages/stage-09-card-sync.md) `[risky]`; needs 05, 08
- 10 [Approvals read API](stages/stage-10-approvals-read-api.md); needs 01, 08
- 11 [Approvals write API](stages/stage-11-approvals-write-api.md) `[risky]`; needs 09, 10
- 12 [Approvals page](stages/stage-12-approvals-page.md); needs 07, 11
- 13 [Approvals edit](stages/stage-13-approvals-edit.md); needs 12
- 14 [Delegates API](stages/stage-14-delegates-api.md); needs 01
- 15 [Delegations API](stages/stage-15-delegations-api.md); needs 09, 14
- 16 [Remind now](stages/stage-16-remind-now.md) `[risky]`; needs 15
- 17 [Delegates page](stages/stage-17-delegates-page.md); needs 07, 14
- 18 [Delegations page](stages/stage-18-delegations-page.md); needs 16, 17
- 19 [Docs](stages/stage-19-docs.md); needs 01–18
- 20 [VPS deploy](stages/stage-20-vps-deploy.md) `[risky]`; needs 19

## How to run (coordinator)

- Worker `claude-sonnet-5-5` with `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/` first.
- Lanes: {01→02→03}, {04→05}, {06}, then by "Needs". 01 and 07 never next to another `bun.lock` change; 06 never next to another migration.
- Land with the `spec/build.md` land check; drop the job DBs. Stage 20: the coordinator.

## Planning progress

- [x] Decisions, commands.md, questions.md; stages 01–20 `[written]`. `wc -w`: plan.md 1497; stages 366–699 each.
- [ ] Cold review.

## Cold review

Pending.

## Log

- 2026-11-15: planned (Opus 5.5) at `5e07cdf2`.
