# F168 scouts

Three scouts ran at plan base 8c9acfc1e (2026-11-23). Each packet is copied whole. A packet is a lead; the plan checked the facts its decisions use (plan.md § Facts checked).

## Scout 1

Job id: `2026-11-23-f168-scout-1-518be4ef`

Question:

```
How does the approvals page of apps/web work today? Name the island, its components, the API calls (list, approve, reject, edit, reply-draft controls), the response fields per draft (status values, end reasons, recipients, expiry, superseded), how ?id=<id> is handled (Telegram links), what stops a double approve today (client and server: conditional update, error code on a second approve), and how the page learns that another device decided a draft (polling, refetch, error code). Context: spec/features/planned/F168-approvals-is-a-one-draft-at-a-time-queue-and-activity-and-review-have-the-pebble-look/ticket.md. Answer for the code at HEAD.
```

Packet:

Packet: How the approvals page of apps/web works at HEAD (island, components, API, fields, ?id, double approve, cross-device updates)
Base: 8c9acfc1e
Verified: `git status --short` in the worktree -> empty output (nothing edited). Only reads and greps ran. I ran no test and no server.
Unknowns: Where `closedStateOf` maps `approved` to `held` or `sending` (`approval-routes.ts:40-60`). I read only its header comment. I did not read `approvals-read.ts` or the web edit dialog internals (`ApprovalEditDialog.tsx`, 279 lines).

1. **Island and components** — observed.
   - `pages/approvals.astro` mounts `islands/ApprovalsPage.tsx` with `client:only="react"`, inside `AppShell`.
   - The inner `Approvals()` (`ApprovalsPage.tsx:81`) is a master/detail grid. The list sits on the left, the detail on the right, and one draft is open at a time (`:378-381`).
   - Components in `components/approvals/`: `ApprovalList` (links `/approvals?id=…`), `ApprovalSummary`, `ApprovalDetailPanel`, `ApprovalActions` (Approve, Reject, Edit, plus `RejectReason`), `ApprovalEditDialog`, `ReplyControls`, `AddressList`, and the hook `use-reply-actions.ts`.
   - There is a notice line (`role=status`) plus a destructive `Alert` for errors. When the list answers 404 the feature flag is off, and the page shows `appr_off` (`:141`).

2. **API calls** (`lib/approvals-api.ts`, `lib/replies-api.ts`) — observed.
   - `GET /api/approvals` returns the list.
   - `GET /api/approvals/:id` returns the detail. A 404 or 400 becomes `null`, which shows "not found".
   - `POST /api/approvals/:id/approve` and `/reject` both send body `{}`.
   - `POST /api/approvals/:id/edit` sends `{subject, body, delegateId?}`.
   - `POST /api/actions/:id/reject-reason` runs only when feature `mistake_capture` is on.
   - Reply-draft controls: `POST /api/approvals/:id/redraft {instruction}` returns `{requestId}`. The page then polls `GET /api/replies/requests/:id` every 2 s for at most 60 s (`waitForReply`). Outcomes are done, superseded, ended or timeout. `POST /api/approvals/:id/recipients {mode: from|reply_to|all}` returns a new version at once (no model).
   - The server routes are in `apps/server/src/modules/channels/approval-routes.ts:71-195`.

3. **Fields per draft** (`packages/core/src/web/approvals.ts`, strict Zod schemas) — observed.
   - List item (`:83`): `id`, `mailboxAddress`, `createdAt`, `delegationId`, `setId`, `loopId?`, `sender?`, `version`, `state` (waiting|held), `draftReady`, `kind`, `expiresAt`, `heldBy` (scope|paused|auth_error|host_blocked|null), `view`.
   - Reply-only fields: `instruction`, `redraftsLeft` (0–5), `recipientsMode` (from|reply_to|all), `replyAllAdds`.
   - Detail (`:104`): `state` is one of waiting, held, sending, sent, rejected, expired, failed, superseded. It adds `endReason?`, `draftRemovable`, `currentId`, `quote`, `delegates`. `expiresAt` is set only for waiting and held. `version`, `kind` and `view` can be null after retention clears them.
   - `endReason` (`:71`) appears only on `expired`: answered, newer_mail, original_moved, policy_changed, suspicious, sent_by_user, draft_changed, draft_missing. A plain timeout has no `endReason`.
   - Recipients live in `view` (`outgoing/view-schema.ts:14-35`): `recipient{name,address}`, `recipientInactive`, `to[]`, `cc[]`, `replyTo[]`, `gaps[]`, `sentVisible`.
   - Superseded: detail `state="superseded"` with `currentId` (the newest version).

4. **`?id=<id>` handling** — observed.
   - `lib/use-selected-id.ts` reads `location.search` `id` on mount and on `popstate`.
   - A click pushes a history entry. A redirect to a newer version uses `replaceState`.
   - Telegram links work because the page reads `id` straight from the URL and loads the detail with `loadDetail(id)` (`ApprovalsPage.tsx:32`). The list does not need to contain the id.
   - A superseded detail with a `currentId` auto-selects it with "replace" and shows `appr_superseded` (`:115-120`). It skips this while the edit dialog is open.

5. **Double approve and cross-device** — observed.
   - Client:
     - `singleFlight` (`lib/single-flight.ts`) sets a flag at once and drops a second call.
     - The `busy` state disables the buttons.
     - `useReplyActions` has a `running` ref for the same purpose.
     - The Approve button is also off when the draft is not ready or a reply has gaps.
   - Server: `approve()` locks the send row (`lockSend`) inside one transaction (`actions/approvals.ts:257-265`).
     - `awaiting_approval` goes through `setApproved`, a guarded `UPDATE` (`repo/sends.ts:276`, `statusGuard`).
     - A second approve finds `approved`. If `locked_at` is null or older than 10 min (`STALE_AFTER_MS`, `constants.ts:4`), it returns `already_approved` and the route answers 200 `{status:"approved"}`, which is not an error (`approval-routes.ts:118`).
     - If `locked_at` is fresh, it returns `sending` and the route answers 409 `{error:"closed", state:"sending"}`.
     - `applied` returns 409 closed `sent`, `rejected` returns 409 closed `rejected`, and `failed` returns 409 closed `failed`.
     - An expired send returns 409 closed `expired`. A superseded send returns 409 `{error:"changed", currentId}`.
     - Other 409 codes: `draft_not_ready`, `has_gaps`, `feature_off`, `drafts_off`. A missing send returns 404 `not_found`.
   - Cross-device (decided on another device):
     - There is no push, SSE or websocket.
     - The list polls every 30 s (`useResource` default `pollMs` 30_000), only while the tab is visible (`lib/poll.ts`, `startPolling` with a `doc` argument). I did not read the visibility check in `poll.ts`; this comes from the `CLAUDE`-style comment at `ApprovalsPage.tsx:85`.
     - The open detail is loaded once per selection (`useReloadOn(id, …)`). It polls every 5 s only while `waiting && !draftReady` and the edit dialog is closed (`:30`, `:93`).
     - A stale click on the other device gets a 409 `closed` or `changed`. `failureOutcome` (`lib/approvals-view.ts:164`) turns it into an info notice, such as `appr_closed_sent` or `appr_changed`, then reloads the detail and the list. For `changed` with a `currentId`, it opens the newest version.
     - After a successful approve the page re-reads the detail and picks the message from the real state (`approveMessage`), never from the approve answer alone.

Checks: `apps/web/src/lib/approvals-view.test.ts` and `approvals-components.test.tsx` exist for the view logic and components; I did not run or read them. They probably cover `failureOutcome` and `approveMessage`, but that is a guess. I did not look for a test of the single-flight guard or the 30 s poll, and I did not run any test.

## Scout 2

Job id: `2026-11-23-f168-scout-2-bf81b449`

Question:

```
How do the activity page and the review page ('Was I right?') of apps/web work today? Name the islands, components, filters, day grouping, row actions, empty states, the correction picker, the API calls and fields, and every emoji in their text keys (apps/web/src/i18n/en.ts and pl.ts, give key names) or components. Context: spec/features/planned/F168-approvals-is-a-one-draft-at-a-time-queue-and-activity-and-review-have-the-pebble-look/ticket.md. Answer for the code at HEAD.
```

Packet:

Packet: How the activity page and the review page ("Check 10 decisions") of apps/web work at HEAD
Base: 8c9acfc1e
Verified: `grep -nP '[emoji ranges]'` over components/activity, components/review, lib and i18n -> `i18n/texts/en-reply.ts:120:  rv_right: "✅ Right",` | I did not run the app. All findings come from reading the code.
Unknowns: whether `/api/activity` and `/api/review/*` have extra server-side behaviour. I read only the web side and the zod schemas in `packages/core/src/web/`. The Telegram `/review` twin is out of scope. I did not open `pl.ts` for the review title, only the `pl-*.ts` text files.

**Activity page**

1. **Islands.** `pages/activity.astro` mounts `islands/ActivityPage.tsx` with `client:only="react"`, inside `AppShell active="activity"`. The nav item has no feature flag. — observed
   - `Activity()` holds `filters`, `lastLoad` and `refreshSignal`.
   - Filters sync to the URL with `history.replaceState`.
   - The header shows `updated_at` with `formatClock` and a Refresh button.
   - The page wraps its content in `DelegateHintProvider`.
2. **Components.** `ActivityFilterBar`, `ActivityList` (plus `ActivitySkeleton`), `ActivityRow`, `ActionButtons`, `CategoryPicker`, `ActivityPanel`, `DelegateAction` (with `DelegateDialog`) and `DraftReplyAction`, all in `components/activity/`. — observed
3. **Filters.** `lib/activity-filters.ts` defines four filters, each stored in the URL as a query parameter. — observed
   - Mailbox: a select, shown only with 2 or more mailboxes. An unknown id falls back to "all". Param `mailbox`.
   - Category: `all`, `action`, or one of the `categories`. Param `category`. `action` sends `NEEDS_ACTION_CATEGORIES` joined by commas. The labels are `act_all_categories`, `act_needs_action` and `act_tag_<cat>`, so the category dropdown shows emoji.
   - Range: `24h`, `7d`, `30d` or `90d`, from `activityRanges`. Param `range`. `ACTIVITY_DEFAULT_RANGE` is the default.
   - A "Only not rated" switch. Param `notRated=1`.
4. **Day grouping.** There is none. — observed
   - `ActivityList` renders one flat `<ul className="flex flex-col divide-y rounded-md border">`, newest first (`received_at DESC, id DESC`).
   - A row shows `formatClock(receivedAt, tz, now, locale)` · sender · optional mailbox address. `formatClock` comes from `@ea/core/web`, and I did not read it.
   - Paging uses `nextBefore` and an `act_load_more` button, with a 50-item page size (`ACTIVITY_PAGE_SIZE`).
   - `use-activity-list.ts` polls every 30 s (`pollMs=30_000`) and merges the result with `mergePolled`.
5. **Row.** `ActivityRow` shows these parts. — observed
   - The sender and time line, then the subject (`act_no_subject` or `act_unknown_sender` as fallbacks).
   - The category tag, the confidence (`act_confidence`) and `item.phrase`.
   - A badge for the sender rule (`act_rule_*`), a badge for the delegation, and an `act_undo_pending` badge.
   - Clicking the row body opens `ActivityPanel`, a Sheet (right side at 1024 px or wider, otherwise bottom). The panel has these sections: why (`aiText` or `act_no_reason`, plus the rule line), what the assistant did (`actions[].phrase` with `appliedAt`), delegation (with the due time), and feedback state (`feedbackStateText`).
6. **Row actions.** The row and the panel share `ActionButtons`. — observed
   - ✅ `act_icon_right`: shown when the item's category is a `LabelCategory`. It posts `trueCategory` equal to the AI category. Its aria-label is `act_btn_right`.
   - ✏️ `act_icon_edit`: opens `CategoryPicker`.
   - ↩️ `act_icon_undo`: shown when `item.undoable`. It posts an undo.
   - `DelegateAction` (`dla_*`): a dialog with a delegate select. It shows when `showDelegateAction` returns true, and it needs active delegates from `DelegateHintProvider`.
   - `DraftReplyAction`: `rp_draft_reply`, or `rp_open_draft` linking to the approval. It shows only when `item.reply` is present (flag `reply_drafts`).
   - A paused organization (`!canWrite(me)`) disables the feedback and undo buttons.
   - After a successful call, `onPatch` updates `feedback`, `undoable` and `undoPending` in place. A 404 shows `err_not_found` and refreshes the list.
7. **Empty and error states.** — observed
   - Loading: a skeleton of three `h-16` blocks (`ActivitySkeleton`).
   - Load error: `act_load_error` with a Retry button.
   - Refresh error with items on screen: `act_refresh_error` with a Retry link.
   - Empty: `act_empty`. When `me.mailboxCount === 0` it also shows `act_no_mailbox` and an `act_open_mailboxes` button linking to `/mailboxes`.
   - Load-more error: a toast with `error_generic`.
8. **Correction picker (`CategoryPicker`).** A Dialog titled `act_pick_title`, with the help text `act_pick_help` ("AI said: X"). — observed
   - It shows the subject, then one outline button per `labelCategories` entry, labelled `categoryTagText(c)` (the emoji tag). The AI's own category uses `act_pick_ai` ("{category} (AI)").
   - A ghost Cancel button closes it. Picking a category posts the feedback and shows a toast from `feedbackToast("pick")`.
9. **Activity API calls.** `lib/activity-api.ts`. — observed
   - `GET /api/activity?since=<ISO now minus range>&mailboxId=&categories=a,b&notRated=true&before=<cursor>`. The answer is `{items, nextBefore}`.
   - Item fields: `emailId`, `mailboxId`, `receivedAt`, `triagedAt`, `from`, `subject`, `category`, `confidence`, `modelCategory`, `aiText`, `phrase`, `actions[]`, `undoable`, `undoPending`, `feedback`, `delegation`, `suspicious[]`, `rule`, optional `sender`, optional `reply:{sendId}`. The schema is `packages/core/src/web/activity.ts:78`.
   - `POST /api/feedback {emailId, trueCategory}` returns `{saved, verdict, aiCategory}`.
   - `POST /api/actions/undo {emailId}` returns `{kind: started|already|nothing, created?}`.
   - `GET /api/mailboxes` is read for the mailbox filter.
   - The delegate and draft actions have their own calls (`postDelegateMail`, and the reply-draft API).

**Review page ("Check 10 decisions")**

10. **Islands and flag.** `pages/review.astro` mounts `islands/ReviewPage.tsx` inside `AppShell active="settings"`, with `title_review` = "Check 10 decisions". — observed
    - The page has no nav item. It is reached from the report page through `reviewHrefFor`.
    - Flag `panel_review` in `me.features`. When the flag is off, the page shows `rep_off` and calls no review route.
    - The mailbox comes from `?mailbox=` or the newest one (`pickReportMailbox`). With 2 or more mailboxes it shows `MailboxSelector`. With none it shows `rv_no_mailbox` and a button to `/mailboxes`.
    - `MailboxReview` is keyed by mailbox. It loads once (`pollMs: 0`) and has no filters and no day grouping. Answers are kept in `answers[emailId]` for this page load only.
11. **ReviewContent.** `components/review/ReviewContent.tsx`. — observed
    - It shows `rv_intro`, then `rv_progress` ("{answered} of {total} answered"), then a flat `<ul>` of `ReviewItemCard` (rounded cards).
    - A card shows time · sender name, the subject, `categoryTagText(category)` · `rv_sure` ("Sure: N %"), and the optional `aiText`.
    - Once answered, the buttons are replaced by a `role="status"` line holding the saved-toast text from `feedbackToast`.
    - A "Done" button (`rv_done`) appears while the page is unfinished. After "Done", or once all items are answered, the page shows `rv_thanks` and a `rv_back` link to `reportPath(mailboxId)`. After that the cards are locked.
12. **Row actions on the review page.** — observed
    - `rv_right` ("✅ Right") is hidden when the category is `unsure` (`canConfirm`).
    - The correction picker is a native `<select>` with the label `rv_pick_label` and the placeholder `rv_pick_none`. Its options come from `pickCategories`, which is `reviewLabelCategories` and drops `delegation` unless `sample.delegation` is true or the item is already a delegation. A Save button (`save`) is disabled until a category is chosen.
    - Buttons are disabled while a write is in flight or the organization is paused.
13. **Empty and error states.** — observed
    - Loading: a skeleton.
    - Load error: `rv_load_error` with a Retry button (`retry`).
    - Empty sample: `rv_empty` ("no unchecked decisions from the last 30 days"), plus the back link.
    - A 404 on save puts `err_not_found` into that item's answer. Other errors show a toast.
14. **Review API calls.** `lib/review-api.ts`. — observed
    - `GET /api/review/sample?mailboxId=` returns `{items: PanelReviewItem[] (max 10, PANEL_REVIEW_SIZE), delegation: boolean}`.
    - Item fields: `emailId`, `receivedAt`, `fromName`, `subject`, `category`, `confidence`, `aiText`. The schema is `packages/core/src/web/review.ts`.
    - `POST /api/review/label` with `{emailId, verdict:"right"}` or `{emailId, category}` returns `{saved, verdict, aiCategory}`.

**Every emoji in text keys** (`en` and `pl` use the same emoji unless noted)

15. `i18n/texts/en-activity.ts` and `pl-activity.ts`. — observed
    - Category tags: `act_tag_urgent` 🔴, `act_tag_needs_reply` ✉️, `act_tag_delegation` 👥, `act_tag_info` ℹ️, `act_tag_notification` 🔔, `act_tag_spam` 🚫, `act_tag_unsure` ❓. They show in the filter dropdown, the row, the panel, the picker and the review card.
    - Action icons: `act_icon_right` ✅, `act_icon_edit` ✏️, `act_icon_undo` ↩️.
    - Toasts: `act_toast_right` ✅, `act_toast_picked` ✏️, `undo_started` ↩️.
    - `act_cat_*` names carry no emoji.
16. `en-reply.ts:120` and `pl-reply.ts:126`: `rv_right` = "✅ Right" / "✅ Trafna". Review title, intro, progress, thanks and the other `rv_*` keys carry no emoji. — observed
17. `en-reply-panel.ts:86,88` and `pl-reply-panel.ts:88,90`: `rp_draft_reply` and `rp_draft_reply_for` start with ✍️. `DraftReplyAction` renders them in the activity row. — observed
18. `en-settings.ts:37` and `pl-settings.ts:41`: a settings help text mentions "✅ or ✏️" and points to the Activity page. It is not on either page itself. — observed
19. Emoji in components: none. All emoji come from text keys. The `Activity` icon in `nav-items.ts` is a lucide icon, not an emoji. — observed
20. The grep also matched `→` in mailbox and phone help texts and in `totp-setup.ts` comments. These are not emoji and are not on these pages. — observed

Checks: `lib/activity-filters.test.ts`, `activity-list.test.ts`, `activity-text.test.ts`, `review-view.test.tsx` and `delegate-action.test.tsx` exist and cover the pure logic of these pages. I did not run them. They would not cover any new look (the pebble look) in F168.

## Scout 3

Job id: `2026-11-23-f168-scout-3-f1600374`

Question:

```
Which tests and docs cover the approvals, activity and review pages of apps/web? List the e2e specs (apps/web/e2e), the demo recording spec, the docs-shots spec, the seed data they use (how many waiting drafts, which states), the Pixel 7 project, unit tests of web lib code for these pages, the sections of docs/capabilities/web-panel.md and the user docs pages (apps/docs) for these pages, and the locators/data-* attributes and text keys the specs depend on. Context: spec/features/planned/F168-approvals-is-a-one-draft-at-a-time-queue-and-activity-and-review-have-the-pebble-look/ticket.md. Answer for the code at HEAD.
```

Packet:

Packet: Which tests and docs cover the approvals, activity and review pages of apps/web?
Base: 8c9acfc1e
Verified: `git status --short` -> empty output (read-only held). I ran no tests; all findings come from reading files.
Unknowns:
- I did not read the unit tests of web lib for the content of their assertions. I only listed their names (guessed).
- I did not open `apps/web/src/i18n/en.ts` to confirm each key exists (guessed; the specs import `en` directly, so a missing key fails typecheck).
- I did not find the SHOTS list of `apps/web/e2e/lib/shot-source.ts`. I took the page list from `apps/docs/src/shots.ts:24`.
- I did not read the "Tests" section of `docs/capabilities/web-panel.md` to its end. Lines 167–175 are cut off.

1. **E2E specs (`apps/web/e2e/tests/`)** — observed.
   - `approvals.spec.ts` (510 lines, serial): T4, T5, T8, T9, T10, T7, S13-T6, S13-T4, S13-T5, S13-T8, S13-T7 (desktop only), S13-N1 (desktop only), S13-TG2, S13-T3. The tests change state, so order matters.
   - `activity.spec.ts` (258 lines, serial): rows, panel, filters and load more; the sender line; ✅ and ✏️ feedback; ↩️ Undo; another organization's mail gives 404; an assistant member rates mail. It turns on the `why_lines` flag in `beforeAll`.
   - `review.spec.ts` (211 lines, serial): RV1–RV7. They read the state left by the earlier test: 10 items, then 2, 3, 4 and 12 labels, then empty.
   - Related specs: `urgencyzz-review.spec.ts` is about the urgency card, not the review page. `report.spec.ts` links to `/review`. `polish.spec.ts:59` checks `/activity` in Polish. `pwa.spec.ts:32` uses `start_url=/activity`.
   - The Pixel 7 project is `{ name: "mobile", use: { ...devices["Pixel 7"] } }` in `apps/web/e2e/playwright.config.ts`. The other project is `desktop` (1280×800). `workers: 1`, projects run one after the other.
   - Two tests skip on mobile: S13-T7 and S13-N1. T10 branches on mobile: the tab bar has 5 links and Stats is in the menu; the desktop sidebar has all 6.

2. **Seed data, observed.**
   - Approvals (`apps/server/src/scripts/e2e-seed/args-approvals.ts`): one organization per project, with 6 sends in the list. Five are waiting (`E2E_APPROVALS_WAITING=5`): `waiting` (Anna Nowak, "E2E budget plan"), `edit`, `closed`, `race` and one reminder. One is held (`held`, Piotr Lis; approved, but `SEND_SCOPE=self` holds it). `E2E_APPROVALS_COUNT=6`. The flags `approvals_page`, `stats_page` and `mistake_capture` are on. The member sees the list but has no buttons. The specs use `readSeed().approvalsOrgs[project]`.
   - The main organization has `approvals_page` off. T4 checks this.
   - Review (`args-review.ts`): 12 mails (`E2E_REVIEW_MAIL_COUNT=12`), with a triage result and no label; the flags `panel_review` and `trust_ladder` are on. Subjects are `E2E review subject NN` and senders `E2E Review Sender NN`. There is no delegate. It has its own owner and member per project. `RV7` uses `trustOrgs` (flag off).
   - Activity (`args-activity.ts`, `e2e-activity.ts`): mails moved, reply, unsure and delegated (`ACTIVITY_SUBJECTS`), plus 52 fillers. The spec expects 50 rows and 56 after "load more".

3. **Demo and docs-shots, observed.**
   - `apps/web/e2e/demo/record.spec.ts:199` has step 6 `approval`: `/approvals?id=<editSendId>`, Edit, Save, Approve. Step 8 `undo` (`:233`) uses `/activity` and `li[data-email-id]`. There is no review step. The spec is described in `demo/README.md` rows 6 and 8, and the steps are in `lib/demo/steps.ts:102`.
   - `docs-shots/shots.spec.ts` covers `/activity` only. `TITLE_KEYS` maps `"/activity"` to `title_activity`. The page list is `SHOT_PAGES` in `apps/docs/src/shots.ts:24`: onboarding, mailboxes, settings, rules, activity. It uses the owner of the main organization with no flags. Phone shots use `devices["Pixel 7"]`. It waits for the heading and for `[aria-busy="true"]` to be gone, then checks the public-content rules. Approvals and review get no shot.

4. **Locators and keys the specs depend on, observed.**
   - Approvals: roles and names only. `region` named `appr_detail_label`; `list` named `appr_list_label` with links as items; `status` (the focus goes there after an answer); `dialog` named `appr_edit_title` or `appr_edit_discard_title`; `combobox` named `appr_reason_label`; `navigation` named `nav_main`; the nav badge `nav_approvals` plus `nav_approvals_badge` with `{n}`. Keys: `appr_approve`, `appr_reject`, `appr_edit`, `appr_done_*`, `appr_state_*`, `appr_edit_*`, `appr_version`, `appr_held_scope`, `appr_external`, `appr_send_note`, `appr_title_reminder`, `appr_off`, `owner_only`, `title_approvals`, `menu_open`, `save`. The page URL is `?id=`. Tests use `expectNoA11yViolations` and `cspErrors` too.
   - Activity: `li[data-email-id]`; `combobox` `act_filter_category` and `act_filter_range`; `switch` `act_not_rated`; `dialog` as the panel; buttons from `act_btn_right` (with `{category}`), `act_btn_edit`, `act_btn_undo`, `act_load_more`. Texts: `act_tag_*`, `act_confidence`, `act_dlg_line`, `act_rule_*`, `act_toast_*`, `undo_started`, `act_undo_pending`, the `/^Updated /` text, `sender_*`. Filters appear in the URL as `category=action`.
   - Review: `[data-review-item]` (value is the email id), `[data-review=answer|progress|thanks|empty]`, `option[value=delegation]`, the `select`, `rv_pick_label` (`getByLabel`), `rv_right`, `rv_done`, `rv_back`, `rv_intro`, `rv_thanks`, `rv_empty`, `rv_progress` (with `{answered,total}`), `rep_review_link`, `rep_review_suggest`, `rep_off`, `[data-report-state=done]`. The route is `/review?mailbox=<id>`. The API calls are `/api/activity?mailboxId=…&limit=100` and `/api/review/sample`.

5. **Unit tests, capability page and user docs, observed.**
   - Unit tests in `apps/web/src/lib/`: `activity-filters.test.ts`, `activity-list.test.ts`, `activity-text.test.ts`, `approvals-components.test.tsx`, `approvals-edit.test.ts`, `approvals-view.test.ts`, `review-view.test.tsx`, `nav-items.test.ts`, `focused-row.test.ts`, `draft.test.ts`, `api.test.ts`. The components are in `components/{activity,approvals,review}/` and the islands in `islands/{Activity,Approvals,Review}Page`. No `.test.*` file exists in `components/`.
   - `docs/capabilities/web-panel.md` has these sections: "What it does now", "Rules", "Entry points", "Data", "Limits", "Decisions", "Tests". The relevant parts are: Rule 6 (the route table: `tenancyRoutes` gives `approvalsWaiting`, `reviewRoutes`, `activityRoutes`, `approvalRoutes`), Rule 9 (the pages), Rule 18 (reply drafts on the approvals page), and the Entry points rows at lines 78, 83 and 85, plus 92 and 123–124. Limits lines 139, 141, 143 and 146 cover the flags, the sender line, and the 30-second polling of Activity. Tests section: line 165 on.
   - User docs (`apps/docs/src/content/docs`, with Polish copies in `pl/`): Activity is covered in `how-to/undo-a-move.mdx` ("Undo in Activity"), `how-to/correct-a-category.mdx` ("Confirm or correct in Activity"), `start/index.mdx`, `faq.mdx`, `reference/settings.mdx`, `explanation/shadow-and-assist.mdx` and `explanation/how-a-mail-is-sorted.mdx`. They use `<UiText k="nav_activity" />`. `faq.mdx` and `reference/telegram.mdx` mention approvals once each. No page covers review. The docs site has no dedicated approvals page.

Checks: the three Playwright specs cover behavior, focus, axe and role names on both projects. They miss any layout or visual look, a queue that shows one draft at a time (they assert the list of 6 links and the detail region), and any `/review` and `/approvals` screenshot. The unit tests cover the view logic, but I did not read their assertions.
