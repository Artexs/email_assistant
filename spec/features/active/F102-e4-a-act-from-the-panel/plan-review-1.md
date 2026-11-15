PASS 262fd4f95b8561e3cc4077a0c09361a515ba91a2

The plan can be built. No finding proves that an acceptance bullet cannot hold, so nothing blocks. Several gaps would let a real bug reach the user. Fix N1–N6 in the plan before stages 06, 08 and 09 build.

HEAD: `git rev-parse HEAD` = 262fd4f95b8561e3cc4077a0c09361a515ba91a2. It matches the candidate. The tree is clean.

## Unverified checks
- I ran no test suite. The candidate is a plan with no code diff, so no suite can tell it apart. I did not run `bun install`. Every finding below comes from reading the code at HEAD.
- I did not verify F1 (the `hono-openapi` 1.6.0 probe), and the plan names no artifact for it. I also did not check the peer dependencies of `hono-openapi` in stage 01. Stage 01 asks the worker to list them, which is enough.

## Pre-mortem (which stage lets the bug through)
- **Stage 08:** after an edit, the old draft stays in Drafts (N1). An edit can also survive a switch to shadow mode (N5).
- **Stage 09:** a Telegram card shows a state that is no longer true (N3, N4).
- **Stage 06:** the stage's own Proof fails, or the worker must guess (N2).
- **Stage 20:** after a rollback, waiting approval cards never arrive (N6).

## Notes

**N1 — proven by code reading. Stage 08: the old Drafts copy is never removed.** This is a missing decision and a missing test.
- The plan says the old draft closes with reason `superseded` (plan.md:22, stage-08:22). Today `closeDraftOfSend` accepts only `"sent" | "rejected" | "expired"` (actions/expiry.ts:94).
- The reverse row stores the reason in a loose payload (repo/undo.ts:71), so typecheck does not catch a new value.
- `removeDraft` then parses that payload with `reversePayloadSchema`, whose reason enum is `["sent","rejected","expired"]` (actions/drafts.ts:262-267). A parse failure ends in `failDraft(bad_payload)` (drafts.ts:277-278).
- `markUndone` (repo/undo.ts:12) and the `undone` edge in `transitions.ts:324` have the same three reasons.
- Result: the reverse row fails and the old text stays in Drafts, next to the new version. Stage 08 T1 (stage-08:28) only checks that "one reverse row for D1" exists. It never runs the committer on that row.
- Fix: either keep `expired` as the draft-close reason, or name all three places. Add a test in which a committer run deletes D1's copy.

**N2 — proven by code reading. Stage 06 depends on stage 05, and its Proof cannot pass as written.**
- Stage 06 "Needs nothing" (stage-06:3, plan.md:97), and the lanes {04→05} and {06} run in parallel (plan.md:116).
- But its view schema allows outcome `changed` "(stage 05)" (stage-06:33). `ApprovalEditOutcome` has no `changed` until stage 05 lands (packages/core/src/digest/approvals.ts:361-371).
- `channels/notices/registry.test.ts:15-17` fails for a kind that has no detector and no `queuedBy` entry. code-patterns.md:95-96 says this too. The producer only comes in stage 09.
- Stage 06 T7 names "registry.test.ts" without saying which one (core or channels).
- Also undecided: the `NOTICE_MAIL_CONTENT` class of `approval_edit` (privacy/outbox.ts:19; typecheck forces a choice). Its view holds the full card text.
- Fix: make 06 need 05, and say who adds the `queuedBy` entry and when. Or move Step 2 of stage 06 into stage 09.

**N3 — proven by code reading. Stage 09: one edit per card blocks a second decision.** This is an event that no rule covers, and two rules conflict.
- The edit dedup key is `approval_edit:<target id>` (stage-09:14), and T8 requires one row per card (stage-09:30). Inserts use `onConflict(...).doNothing()` on `UNIQUE (org_id, user_id, dedup_key)` (channels/repo.ts:258; db/migrations/20261106000001_telegram.sql:72).
- Case: an owner approves, the send is held (`approved_held`), and later someone rejects it. That can be a panel Reject (Q13) or a Reject tap on the tapper's card (approval-taps.ts:121 keeps that button).
- The second `onDecided(rejected)` then queues nothing. The other owners' cards keep showing "Approved, held" for a send that is rejected.
- Also, the plan's edit view has no `actionId` (stage-09:14). So the other owners' held cards lose the Reject button that the tapper's card keeps (core approvals.ts:403-405). This differs from Q13 ("as the Telegram card").
- Fix: decide the dedup per decision (for example `approval_edit:<target>:<outcome>`), and decide whether held edits carry `actionId`.

**N4 — plausible. Stage 09: a late edit can overwrite a newer card state.**
- The edit text is fixed at queue time (stage-09:14). The sender sends it later, after per-user limits, rate limits or a soft backoff of up to 15 min (sender.ts:26, 145-147, 185-192).
- Meanwhile the user can tap the same card while its buttons still show. The tap edits the card at once (approval-taps.ts:118, 155). The queued row then edits it back to the older result.
- No rule drops a queued edit when the send changed after the queue, or when the target was edited since.
- Fix: decide on a check before the send (send state, or no newer edit of the target), and add a test.

**N5 — plausible. Stage 08: the settings lock rule (M13) is missing.** `editApproval` plans a new `create_draft` and `send`.
- The other planners share-lock the mailbox settings row as their first statement: chaser.ts:106-107, triage/service.ts:215. Stage 16 does the same for remind now (stage-16:16). Stage 08's lock order is "old send, its draft, delegation" (stage-08:18).
- Race: a setter (shadow mode, or `create_draft` off) runs at the same moment as an edit. The setter does not see D2/S2 before the edit commits. The committer has no mode check (no `mode`/`shadow` hit in committer.ts or repo/claims.ts).
- So S2 can wait for approval and be sent in shadow mode.
- Fix: share-lock the settings first and refuse on a version change. Taking the lock after the send lock can deadlock with the setter, which takes settings then send. Add a test.

**N6 — proven by code reading. Stage 20: the rollback misses `approval` rows queued by the new code.**
- Stage 09 Step 2 adds `version` and `panelUrl` to every approval view. The pilot has the flag on (Q10).
- Old code parses views with strict schemas (packages/core/src/notices/views.ts:13, 30). After the rollback, every such pending card becomes `failed`/`bad_view` (code-patterns.md:85-86). The owner never gets the card, because `notified_at` was already set.
- Rollback step 0 (stage-20:42) handles only `approval_edit` rows.
- Also: `draftPayloadSchema` uses `z.object`, which strips unknown keys (payloads.ts:24). After a rollback, old code drops `body_text`/`subject_text` and sends the template text. Stage-20:44 says only that the new version "waits as a normal send".
- Fix: add the pending `approval` rows to step 0, with a re-queue decision, and state the edit-loss limit.

**N7 — proven by code reading. Stage 08: a layer rule makes the worker guess an interface.**
- `editApproval` lives in `actions` and must check that `delegateId` is an active delegate of the organization, then read its email and name (stage-08:19, 21).
- `actions` must not import `delegation`: layers.json `sameLayerEdges` allows only delegation→actions, and actions/hooks.ts:5-6 says the same. Only `delegation/repo.ts` reads `delegates`.
- `onSuperseded` returns only `boolean` (commands.md:39). No interface gives `actions` the delegate data.
- Fix: decide on a `DelegationHooks` reader, or have the route (in `channels`) resolve the delegate and pass it in.

**N8 — proven by code reading. Stages 08 and 09: there is no interface for `heldBy`.**
- `onDecided` takes `approved_held` with `heldBy` from "the caller" (stage-08:13). `ApprovalInput` has no such field (approvals.ts:30-34, commands.md:36-38).
- Today the Telegram tap computes the held reason after `approve` commits (approval-taps.ts:112-121). Stage 10 later moves that check into `channels` (stage-10:14).
- Fix: name the field, or the callback, and say when it is computed.

**N9 — proven by code reading. Rule conflict with notices-as-facts.**
- code-patterns.md:82 says a view "holds no phrase of ours". The `approval_edit` view stores `original: target.text` (stage-09:14), which is a rendered card full of our own phrases plus mail text, up to about 4 KB per owner.
- The sender loads the target row anyway (stage-09:18).
- Fix: either write down why this is an exception (code-patterns.md:88 "keeps the stored text"), or store only the target id and read `target.text` at send time.

**N10 — proven by code reading. A panel cancel of a `sent`/`overdue` delegation leaves the reminder cards with live buttons.**
- The plan expires the waiting reminder sends (stage-15:34) through `expireReminderActions` → `expireSend` (expiry.ts:132-151). That path calls no `onDecided`.
- The ticket outcome says "the Telegram cards follow each panel action" (ticket.md:9).
- Fix: decide whether to edit those cards, or accept the gap in writing.

**N11 — proven by code reading. Stage 10 gives a wrong expiry time for held items.**
- D8/stage-10:16 compute `expiresAt` as `notified_at` + 48 h for every item. A held `approved` send closes at `approved_at` + 48 h (`held_timeout`, actions/repo/approvals.ts:37-38).
- So stage 12's "expires in" (stage-12:15) is wrong for held items.

**N12 — plausible. Stage 08 leaves the old copy in Drafts when the server has no UIDPLUS.** This is an edge case with no decision and no test.
- P2 says an edit "replaces the Drafts copy" (plan.md:14). With `uidplus` false, `closeDraftOfSend` writes no reverse row (expiry.ts:111). The old text then stays in Drafts next to the new version.
- Stage 08 tests only "UIDPLUS on" (stage-08:27).
- Fix: decide whether to refuse the edit, warn the user, or accept the gap.

**N13 — plausible. Stage 15: a cancel that races an edit gets the wrong answer.**
- `cancelByUser` reads the delegation, then calls `reject(sendId)`. If an edit supersedes that send in between, `reject` returns `superseded`.
- stage-15:33 maps only `awaiting`, `approved`, `applying` and "other". So the user gets 409 `not_open`, but the delegation is still `drafted` with the new send.
- Fix: decide whether to retry on `currentId` or answer `changed`.

**N14 — fact without a source.** stage-09:10 names "the approval CLI" as a place that builds `ApprovalDeps`. No script calls `approve` or `reject` (grep of apps/server/src/scripts and apps/server/src/*.ts). The only `ApprovalDeps` construction outside tests is channels/approval-taps.ts:87.

**N15 — ticket and stage text differ (not repaired here, detached worktree).**
- ticket.md:29 says "pages … answer 404 with it off". Stages 17 and 18 show a flag-off text on the page (stage-17:12, T8 stage-17:32). Only the API answers 404.
- ticket.md:28 says "the Telegram card of each owner". Q15 (questions.md:23) excludes set cards, and D4 (plan.md:25) accepts the `sending` race. The acceptance bullet should name both exceptions.

**N16 — plausible. Undecided edge case.** A `delegateId` on a `clarification` edit has no answer: stage-08:19 says only "only kind delegation takes it". The route maps 400 codes, so the worker must guess one.

**N17 — plausible. Two stages may be too big for one job.**
- Stage 08 is one step with 11 tests across `actions`, `delegation`, `channels` (tap answer) and the metrics readers, at 697 words.
- Stage 03 Step 2 must describe "any router that landed after the plan base" (stage-03:21-23), which has no upper bound. It needs a stop rule like stage 07's budget.

## The areas you asked about, with no finding
- **Tenant isolation and owner checks:** every new route has an O2 → 404 test, a member → 403 test where the route is owner-only, and a flag-off → 404 test. See stage-10 T1/T4, stage-11 T1/T10/T11/T12, stage-14 T7/T8/T12, stage-15 T4/T6/T11, stage-16 T10. A foreign `delegateId` → `delegate_inactive` (stage-08 T5).
- **One migration:** none is missing. The delegations table already has `status_reason` (db/migrations/20261108000001_delegation.sql:37). Flag keys are not in SQL (20261113110001_org_features.sql:3). There is no CHECK on audit events or on `approved_via`. `error_code` uses only a regex CHECK (telegram.sql:61).
- **`bun.lock`:** only stages 01 and 07 change it (D14, ticket.md:35).
- **Layers, apart from N7:** `approvalRoutes` in `channels` (layer 4) may import actions, delegation, config and tenancy. `delegateRoutes` and `delegationRoutes` in `delegation` receive the card hooks by injection. `tenancy` gets `approvalsWaiting` as an injected function, which is correct.
- **Card length:** `approvalEdit` cuts the original text to make room for the status line (core approvals.ts:438-439), so a 4096-character card plus the result line does not fail.
- **Plan size:** plan.md has 1497 words and the largest stage file 697 (`wc -w`), inside the limits of planner.md § Plan size.

## Checks I ran
- `git rev-parse HEAD && git status --short && test "$(git rev-parse HEAD)" = 262fd4f95b8561e3cc4077a0c09361a515ba91a2`: exit 0, clean tree.
- `wc -w` on plan.md and the stages: 1497; largest stage 697.
- Reads with `nl` and `grep` of every file cited above.
- I ran no lint, typecheck, unit or integration suite (plan-only candidate; see Unverified checks).

## Note check
- HEAD equals candidate 262fd4f95b8561e3cc4077a0c09361a515ba91a2: proven. `git rev-parse HEAD && git status --short && test "$(git rev-parse HEAD)" = 262fd4f95b8561e3cc4077a0c09361a515ba91a2` exited 0.
- Every finding quotes file and line and covers the asked checks (stage 08 supersede, stage 09 card edits vs the sender and notices-as-facts, layers.json, tenant and owner checks, one migration, bun.lock, pre-mortem): proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f102-plan-review-f4a98916/review-findings.md` (the same text as this message).
- Each finding has a label (proven by code reading, plausible, or unverified) and a source in the repo: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f102-plan-review-f4a98916/review-findings.md`, sections N1–N17.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. Each item N1–N17 in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-14-f102-plan-review-f4a98916/review-findings.md` names a missing decision, edge case, test, interface, rule conflict or unsourced fact. No item asks only for line numbers, edit text or file lists.
