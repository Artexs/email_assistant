# F168 plan — the approvals queue, and the Pebble look of Activity and Review

> **Status 2026-11-24 — planned.** Plan base: 8c9acfc1e. Eight stages; nothing built; cold review fixed. No owner step is open.

Shared decisions: [`docs/product/pebble-ui/README.md`](../../../../docs/product/pebble-ui/README.md). Design system: F166 [`interfaces.md`](../../active/F166-the-panel-has-one-pebble-design-system-colours-font-sizes-base-components-patterns-and-checks-that-keep-it/interfaces.md). Drawing: `design/ui-proposals/proposals/03-pebble/shots/`. Owner defaults: [`questions.md`](questions.md).

## Input

The owner's words are on the programme page.

### Product decisions

- **P1 The queue** is the `waiting` sends of `GET /api/approvals`, in API order (newest first). `held` sends are a second group of the waiting list; a pick opens one with only "No", as today.
- **P2 Buttons.** "Yes, send it", "Change" (where `canEdit` allows), "No" in `StickyActions`. "Later" sits in the progress row above the card, away from the thumb. Rejected: "Later" in the bar (a mis-tap skips a draft).
- **P3 After "Yes"** the card shows the outcome with the buttons off, then the next draft comes (`outcomeOf`, stage 03). "Sent to <recipient>" shows only when the detail read after the approve allows it. Failed or unknown outcomes stay with "Next draft".
- **P4 After "No"** with `mistake_capture` on, the card keeps the reason picker until a pick or "Skip"; else it moves on after the hold.
- **P5 "Later"** skips for this page load and sends nothing. When only skipped drafts remain, an end card offers "Show them again".
- **P6 `?id=`.** A `waiting` or `held` draft opens first. Another state shows a closed card (state text, end reason, "Go to waiting drafts"); `superseded` adds "Open the newest version" in place of today's automatic jump. An unknown id shows "does not exist".
- **P7 Another device.** When a reload lacks the focused draft, or its state changed, and this page did not decide it, the page shows its closed text and moves on; `superseded` opens the newest version in place. Triggers: the 30 s poll and the tab turning visible. While the edit dialog or the reason picker is open, P7 and D9 wait; the dialog's own paths decide, as today.
- **P8 Head and cuts.** Titles of Approvals and Activity stay (PB-4, PB-8). The approvals lead counts waiting drafts. No greeting, time promise, category pill (a send has none) or weekly ring (PB-7). A `FactBox` "About this draft" holds the sender line and a reply's instruction ("Why I wrote this" breaks PB-8).
- **P9 Phone list.** Below `lg` "All waiting (n)" opens a `Sheet`; from `lg` an "Up next" card sits beside the draft.
- **P10 Activity filters.** Range: single-choice `FilterChips`. "Only not rated": a toggle chip. Category and mailbox stay selects (nine values do not fit at 320 px). Query parameters stay.
- **P11 Activity days.** "Today", "Yesterday", or weekday and date, in the organization's time zone.
- **P12 Activity empty states.** No mailbox; nothing in the range ("Show 90 days"); filters match nothing ("Clear filters").
- **P13 Activity rows.** `CategoryPill`; every action stays on the row as a labelled icon button; no emoji.
- **P14 Review.** Title "Was I right?"; Polish without first-person past tense. Lead = today's intro. A `ProgressRing`. "It is something else" opens a menu; a pick saves at once (default, Q1).

### Design decisions

- **D1** Stage 01 creates `ApprovalCard({ detail, now, titleRef, children })` and `WaitingList({ items, focusId, now, onPick })` in `components/approvals/`.
- **D2** Stage 03 creates the pure `lib/approvals-queue.ts`; the island holds no queue rule.
- **D3 Locks.** `singleFlight` stays. A handler takes the id of the card it rendered. `SENT_HOLD_MS = 1500` after an outcome; `ARM_MS = 500` before a new card's decision buttons turn on (Q2). A second approve of the same send answers 200, or 409 `closed` `sending` within 10 min of a lock (`approval-routes.ts`, `actions/approvals.ts`); no second mail. The harm of a double tap is a tap on the next card.
- **D4 URL.** A focus change replaces `?id=`; back leaves the page.
- **D5 Contracts other specs use.** The draft card is the `region` named `appr_detail_label`; the waiting list is the `list` named `appr_list_label` with links `/approvals?id=<id>`; `?id=` opens that draft first. `open-loops.spec.ts`, `delegations.spec.ts` and `loops-panel.spec.ts` (F169 owns them) pass unchanged.
- **D6 Focus.** During the hold: the status line (`role="status"`). On a card change: the card title (`h2`, `tabIndex={-1}`); a phone scrolls up.
- **D7 Shared category texts.** `categoryTagText` and `act_tag_*` have readers in Activity (rows, filter labels) and Review. Stages 06 and 08 switch theirs to `act_cat_*`; stage 07 (after both) deletes them.
- **D8** The settings help text that names "✅ or ✏️ … on the Activity page" turns false; stage 07 changes only that value (Q3).
- **D9 Expiry while open.** At `now ≥ expiresAt`, "Yes" and "No" go off and the card reads its detail; then P7.
- **D10 Telegram tie.** `activity-text.test.ts` ties web texts to the core Telegram texts. The tie stays for the words: the test drops the core's leading emoji before it compares. Telegram keeps its emoji (Q5).
- **D11 No approvals user docs here.** The approvals page is behind `approvals_page` (default off); the flagged-text rule (`apps/docs/src/flagged-text.ts`) keeps its strings off the docs site. The user docs wait for the flag removal (Q6).
- **D12** Rule 9 of `docs/capabilities/web-panel.md` is one long line that every page ticket edits: expect land conflicts there; merge `master` and keep both texts.

## Facts checked (2026-11-23, at the base)

- List order `created_at desc, id desc`, cap 100. Superseded: 409 `changed` with `currentId`; closed: 409 `closed` with the state. The poll runs again when the tab turns visible. The approval view has no category or reason text.
- e2e seed: 5 waiting and 1 held send per project; `SEND_SCOPE=self`. Specs that open `/approvals`: `approvals`, `reply-panel` (T5–T7 also test Activity), `open-loops`, `delegations`, `loops-panel`.
- Emoji keys: `act_tag_*`, `act_icon_*`, `act_toast_right`, `act_toast_picked`, `undo_started`, `rv_right`, `rp_draft_reply*`; one settings text. Scouts: [`scouts.md`](scouts.md); review proof of D10: [`plan-review-1.md`](plan-review-1.md) B1.

## Not verified

- Whether `demo:record` runs one step alone (stage 05). The toggle form of a one-option `FilterChips` (stage 06).

## Done when

The 6 acceptance items of [`ticket.md`](ticket.md) hold; each stage's Proof passes.

## Rules for every stage

- Token classes and patterns only (DB-2). Keep every `data-*` attribute a spec reads and the contracts of D5.
- No API, `packages/core/src/web` schema, URL or query change (DB-1). Edit no spec or text file of another ticket, except D8.
- Add a key next to its page's keys; delete a key nothing reads (DB-10). Update your part of `docs/capabilities/web-panel.md` (DB-11, D12).
- Run `UI_SHEET_ROUTES=<route> bun run ui:sheet`, read your pictures, and give their paths in the final message.
- Tests: `docs/code-patterns.md` § Tests; fake timers.
- A gap or a needed deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f168-NN && bun run check:job > /tmp/f168-NN/check.log 2>&1 && bun run web:build:dev > /tmp/f168-NN/build.log 2>&1 && bunx playwright test -c apps/web/e2e/playwright.config.ts <specs of the stage> patterns.spec.ts > /tmp/f168-NN/e2e.log 2>&1 && echo PROOF_OK`. Stages 03 and 05 name their own shorter Proof.

## Owner checkpoints and steps

None (PB-12 looks are in F166 and F172).

## Review

Opus before the land of stage 04 (`[risky]`, sends mail to people); it reads stage 03's module too. Sonnet before the land of 01, 02, 03, 06, 07, 08: "Open the pictures the worker named and the mockup shots; report each difference from the pattern." Stage 05 lands on its proof.

## Stages

| # | Stage | Needs |
| --- | --- | --- |
| 01 | [Approvals frame and the draft card](stages/stage-01-approvals-frame.md) | F166 03, 06, 09, 10 |
| 02 | [Edit dialog and reply controls](stages/stage-02-edit-and-reply.md) | F166 03, 10 |
| 03 | [Queue model](stages/stage-03-queue-model.md) | — |
| 04 | [Queue decision flow](stages/stage-04-queue-flow.md) `[risky]` | 01, 02, 03; F166 06, 10 |
| 05 | [Demo steps](stages/stage-05-demo-steps.md) (coordinator lock: shared demo DB) | 04, 07 |
| 06 | [Activity frame](stages/stage-06-activity-frame.md) | F166 06, 09, 10 |
| 07 | [Activity rows, panel, picker](stages/stage-07-activity-rows.md) | 06, 08; F166 06 |
| 08 | [Review page](stages/stage-08-review.md) | F166 06, 09, 10 |

Width: 01, 02, 03, 06, 08 start together; then 04 and 07; then 05.

## How to run (coordinator)

As in F166 § How to run: move the folder to `active/` and commit; one job per stage, board flags, `--prepare 'bash scripts/limen-prepare.sh'`; the task names the programme page, F166 `interfaces.md`, `ticket.md`, `plan.md`, the stage file and its Proof. Stage 04 at the `[risky]` level. Land with `--keep-open`, the last without; drop the job DB.

## Planning progress

Scouts: 3 ([`scouts.md`](scouts.md)). Stages 01–08 [written]. `wc -w`: plan 1498; stages 697, 586, 693, 699, 294, 655, 699, 657.

## Cold review

One round, Opus 5.5 at high (stage 04 is `[risky]`: it sends mail to people), 2026-11-24: [`plan-review-1.md`](plan-review-1.md). 4 blocking, 6 pre-mortem gaps, 11 notes. All fixed except note 6c (rule 9 line: D12 accepts the conflict) and note 9 (stage 04 stays one stage, programme rule 7; the outcome mapping moved to stage 03).

## Log

- 2026-11-24: plan written; review 1 fixed.
