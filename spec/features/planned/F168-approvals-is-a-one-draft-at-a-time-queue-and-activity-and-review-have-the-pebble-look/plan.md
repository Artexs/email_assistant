# F168 plan — the approvals queue, and the Pebble look of Activity and Review

> **Status 2026-11-24 — planned.** Plan base: 8c9acfc1e. Seven stages; nothing built. No owner step is open.

Shared decisions (PB-1…13, DB-1…11) and § Rules for width: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Names and values from the design system: F166 [`interfaces.md`](../../active/F166-the-panel-has-one-pebble-design-system-colours-font-sizes-base-components-patterns-and-checks-that-keep-it/interfaces.md). Drawing: `design/ui-proposals/proposals/03-pebble/shots/02-approvals-*`, `03-review-*`, `05-activity-*`.

## Input

The owner's words are on the programme page. The owner set the queue safety rule (PB-6) and the cuts (PB-7, PB-8). The ticket acceptance is the target.

### Product decisions

- **P1 The queue.** The queue is the `waiting` sends of `GET /api/approvals`, in the order the API gives (newest first). `held` sends (approved, not sent yet) are not in the queue (`notes/2026-11-23-pebble-ui-transition-analysis.md` § Approvals queue). They show as a second group of the waiting list; a pick opens one with its held text and only "No", as today. Rejected: a client sort by expiry (a second order rule).
- **P2 Buttons.** "Yes, send it" (approve), "Change" (edit, only where `canEdit` allows), "No" (reject) sit in `StickyActions`. "Later" sits in the progress row at the top of the card, away from the thumb. Only the text values change; the key names stay. Rejected: "Later" in the bar (a mis-tap skips a draft).
- **P3 After "Yes".** The card shows the outcome with every button off, then the next draft comes (stage 03 § Outcomes). "Sent to <recipient>" shows only when the detail read after the approve says `sent` or `sending`. An outcome that is not a clean exit (failed, unknown) stays with a "Next draft" button.
- **P4 After "No".** With `mistake_capture` on, the card keeps the reason picker until a pick or "Skip", then moves on. With it off, it moves on after the hold.
- **P5 "Later".** It skips for this page load only and sends no request. Skipped drafts come after the others. When only skipped drafts remain, an end card says how many and offers "Show them again".
- **P6 A link with `?id=`.** A `waiting` draft opens first, then the queue follows. A `held` draft opens its held card. Any other state shows a closed card: the state text, the end reason when the API gives one, and "Go to waiting drafts". `superseded` shows "Replaced by a newer version" and "Open the newest version"; the automatic jump to the newest version goes (ticket acceptance). An unknown id shows "does not exist".
- **P7 Another device.** When a list reload no longer holds the focused draft and this page did not decide it, the page reads its detail, shows the closed text of its state as a notice, and moves on. A `superseded` result opens the newest version in place with `appr_changed` (today's rule). The trigger is today's 30 s poll and the reload on a visible tab; no push channel.
- **P8 Head and cuts.** Title stays `title_approvals` (PB-4). The lead counts waiting drafts (plural through `tp`; at the list cap of 100: "100 or more"). No greeting, no time promise, no category pill (the API has no category for a send), no "approved this week" ring (PB-7). The `FactBox` holds only the sender line and the instruction of a reply. Its title is "About this draft": the mockup's "Why I wrote this" is first-person past tense (PB-8).
- **P9 Phone list.** Below `lg`, an "All waiting (n)" button in the progress row opens a `Sheet` with the waiting list. From `lg`, the list is an "Up next" card beside the focus card.
- **P10 Activity filters.** Range is a single-choice `FilterChips`. "Only not rated" is a toggle chip. Category and mailbox stay selects: nine category values do not fit at 320 px. Query parameters do not change (DB-1).
- **P11 Activity days.** Rows group under "Today", "Yesterday" or a weekday and date in the time zone of the organization.
- **P12 Activity empty states.** (a) No mailbox: "Open Mailboxes". (b) Nothing in the range with the default filters: "Show 90 days" while the range is shorter. (c) The filters match nothing: "Clear filters".
- **P13 Activity rows.** A category is a `CategoryPill`. Every row action stays on the row as a labelled icon button; Undo shows its text. Emoji leave the texts.
- **P14 Review.** Title "Was I right?" (en); the Polish title has no first-person past tense (PB-8). Lead = today's intro. A `ProgressRing` shows answered of total. "It is something else" opens a menu of the allowed categories, and a pick saves at once, like the Activity picker (default, owner to confirm: `questions.md` Q1).

### Design decisions

- **D1 Interfaces of stage 01** (stage 03 uses them): `ApprovalCard({ detail, now, titleRef, children })` and `WaitingList({ items, focusId, now, onPick })` in `components/approvals/`.
- **D2 Queue model** (stage 03): a pure module `apps/web/src/lib/approvals-queue.ts`; the island holds no queue rule.
- **D3 Locks.** `singleFlight` stays. A decision handler takes the id of the card it rendered, never "the current id". `SENT_HOLD_MS = 1500` after an outcome. `ARM_MS = 500`: the decision buttons of a new card stay off for 500 ms after any card change. Fact: a second approve of the same send answers 200 `approved` (`approval-routes.ts`, case `already_approved`). So the only harm of a double tap is a tap on the next card, and the hold and arm stop it.
- **D4 URL.** A focus change replaces `?id=` (`history.replaceState`); the back button leaves the page, not one draft. Rejected: a history entry per draft.
- **D5 Contracts that other specs use.** The focus card is the `region` named `appr_detail_label`. The waiting list is the `list` named `appr_list_label`, with links `/approvals?id=<id>`. `?id=` opens that draft first. `open-loops.spec.ts` and `delegations.spec.ts` (owned by F169) must pass unchanged.
- **D6 Focus.** During the hold the focus is on the status line (`role="status"`). On a card change the focus goes to the card title (`h2`, `tabIndex={-1}`), and the page scrolls to the top on a phone.
- **D7 Shared category texts.** `categoryTagText` and the `act_tag_*` keys have two readers (Activity, Review). The stage that removes the last reader deletes them. At its merge of `master`, the unused-key test shows which stage that is.
- **D8 Settings help text.** The settings help key that names "✅ or ✏️ … on the Activity page" turns false. Stage 06 changes that one value in `en` and `pl` and nothing else in the settings text files (F170 owns them; `questions.md` Q3).
- **D9 Expiry while open.** At `now ≥ expiresAt`, "Yes" and "No" go off and the card reads its detail; then P7 applies.

## Facts checked (2026-11-23, at the base)

- List order: `listApprovalSends` orders by `created_at desc, id desc`, at most 100 (`APPROVAL_LIST_MAX`).
- Second approve: 200 `{status:"approved"}`. A superseded send answers 409 `changed` with `currentId`; a closed send answers 409 `closed` with its state.
- `startPolling` runs again on `visibilitychange` to visible (`lib/poll.ts`).
- The approval view has no category and no reason text (`outgoing/view-schema.ts`).
- e2e seed: 5 waiting and 1 held send per project (`args-approvals.ts`). Pixel 7 is the `mobile` project.
- Specs that open `/approvals`: `approvals`, `reply-panel`, `open-loops`, `delegations`.
- Emoji keys: 16 in `en-activity.ts`, `en-reply.ts` (`rv_right`) and `en-reply-panel.ts` (`rp_draft_reply*`), plus the same keys in `pl`. One settings text (D8). Scout packets: [`scouts.md`](scouts.md).

## Not verified

- Whether `demo:record` can run one step alone: stage 04 checks; else it runs all steps under the shared lock.
- The `aria-pressed` form of a toggle chip in `FilterChips`: stage 05 reads the F166 stage 06 code.

## Done when

The acceptance of [`ticket.md`](ticket.md) holds (6 items), and the specs in each stage's Proof pass.

## Rules for every stage

- Read the programme page, F166 `interfaces.md`, this file and your stage file. Open the mockup shots of your page.
- Token classes and patterns only (DB-2). Keep every `data-*` attribute that a spec reads (`li[data-email-id]`, `[data-review-item]`, `[data-review=…]`) and the contracts of D5.
- No change of an API, a schema in `packages/core/src/web`, a URL or a query (DB-1). Do not edit a spec or a text file of another ticket, except D8.
- Add a text key next to the keys of its page; delete a key that nothing reads (DB-10).
- Update your part of `docs/capabilities/web-panel.md` (DB-11).
- Run `UI_SHEET_ROUTES=<your route> bun run ui:sheet`. Read the phone and desktop pictures in both schemes and languages, and give their paths in the final message.
- Tests follow `docs/code-patterns.md` § Tests. Timers in unit tests are fake; no sleep over 100 ms.
- A gap or a needed deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f168-NN && bun run check:job > /tmp/f168-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f168-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts <specs of the stage> patterns.spec.ts > /tmp/f168-NN/e2e.log 2>&1 && echo PROOF_OK`

## Owner checkpoints and steps

None stops the build. The owner's looks are PB-12 (F166, F172). The reply-draft pilot holds the release, not the build.

## Review

An Opus review before the land of stage 03 (`[risky]`: it sends mail to people). A Sonnet review before the land of stages 01, 02, 05, 06 and 07, with: "Open the pictures the worker named and the mockup shots; report each difference from the pattern." Stage 04 lands on its proof.

## Stages

| # | Stage | Needs |
| --- | --- | --- |
| 01 | [Approvals frame and the draft card](stages/stage-01-approvals-frame.md) | F166 03, 06, 09, 10 |
| 02 | [Edit dialog and reply controls](stages/stage-02-edit-and-reply.md) | F166 03, 10 |
| 03 | [The queue decision flow](stages/stage-03-queue-flow.md) `[risky]` | 01, 02 |
| 04 | [Approvals user docs and demo step](stages/stage-04-approvals-docs-demo.md) | 03 |
| 05 | [Activity frame: chips, days, empty states](stages/stage-05-activity-frame.md) | F166 06, 09, 10 |
| 06 | [Activity rows, actions, panel, picker](stages/stage-06-activity-rows.md) | 05 |
| 07 | [Review page](stages/stage-07-review.md) | F166 06, 09, 10 |

Width: 01, 02, 05 and 07 start together; then 03 and 06; then 04.

## How to run (coordinator)

Move the folder to `active/` and commit it before the first spawn. One job per stage, with the board's worker flags, the personal route and `--prepare 'bash scripts/limen-prepare.sh'`; stage 03 at the board's level for a `[risky]` stage:

```
limen spawn <flags> --label "<what the stage changes> · F168" \
  'Implement F168 stage NN. Read docs/product/pebble-ui/README.md, the F166 interfaces.md, and in spec/features/active/F168-<slug>/ ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: the Proof of plan.md with the specs of the stage. In the final message, list as proven only what a saved log shows.'
```

Land each with `limen land <job> --yes --keep-open`; the last one without. Drop the job DB after the land.

## Planning progress

Scouts: 3 ([`scouts.md`](scouts.md)). Stages 01–07 not written yet.

## Cold review

Not run yet.

## Log

- 2026-11-24: plan written.
