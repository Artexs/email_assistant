# F169 scouts

Four scouts, Sonnet, medium thinking, started 2026-11-23 at plan base 8c9acfc1e. Each packet is copied whole from the scout's last packet message (the job result held only the note check).

## Scout 1

Question: Which delegation statuses exist, how does GET /api/delegations and its filter map statuses to tabs, can the web fetch the columns overdue / waiting for approval / sent / answered separately with today's API, and how does DelegationsPage.tsx hold the ?filter= URL, tabs, paging, the 30 s reload, row actions and focus?

Job: `2026-11-23-f169-scout-1-7a01ec8e`

Packet: delegation statuses, filter-to-tab map, per-column fetch, and how the delegations page holds its state
Base: 8c9acfc1e
Verified: `git status --short | wc -l` -> `0` (read-only held). No tests were run.
Unknowns: whether a "waiting for approval" column and a "sent" column can be loaded separately. With today's API they cannot, because `filter=open` returns `drafted` and `sent` mixed in one cursor stream (observed). Splitting them on the client means paging all of `open` and filtering, which is a guess. I did not read `docs/capabilities/delegation.md` or `OpenLoops` beyond the `Delegations` mount.

1. `packages/core/src/web/delegation.ts:62` — core enum `delegationStatuses` is `drafted, sent, answered, overdue, done, cancelled`. `db/migrations/20261108000001_delegation.sql:35-36` has the same six values in the DB CHECK. The filter enum `delegationFilters` is `open|overdue|answered|closed` (default `open`), and the list query also takes `before` (cursor) and `limit` (max 100). Page size is 50 — observed
2. `apps/server/src/modules/delegation/list.ts:16` — `FILTER_STATUSES` maps `open` to `drafted`+`sent`, `overdue` to `overdue`, `answered` to `answered`, and `closed` to `done`+`cancelled`. `listDelegationPage` (`repo/delegations-read.ts`) orders by `created_at desc, id`. The cursor is base64url of `<created_at with microseconds>|<id>`. It reads limit+1 rows to set `next`. `sendId` is set only for `drafted` rows — observed
3. Per-column fetch with today's API, no change:
   - `overdue` and `answered` are each their own `filter=` value with their own cursor paging. These fetch separately — observed.
   - "Waiting for approval" (`drafted`) and "sent" are not separate. Both sit in `open`.
   - `fetchDelegations(filter, before)` in `web/src/lib/delegations-api.ts` takes one filter per call.
4. `web/src/islands/DelegationsPage.tsx` renders `OpenLoops` if feature `open_loops` is on, else `components/delegation/Delegations.tsx` (303 lines) — observed. Behaviours in `Delegations.tsx` and its hooks:
   - **`?filter=` URL:** `lib/use-delegation-filter.ts` holds it in state, initialised from `filterOf(location.search)`. A tab choice does `history.pushState` to `filterHref` (`/delegations?filter=x`), and `popstate` updates the state. An unknown or missing value gives `open`.
   - **Tabs:** `DelegationFilterTabs.tsx` renders plain links over `delegationFilters`. A plain click calls `onSelect`. Labels and empty texts come from `FILTER_LABELS` and `FILTER_EMPTY` in `lib/delegations-view.ts`. `changeFilter` clears the notice, the `blocked` map and `moreFailed`.
   - **Paging:** `lib/use-delegation-list.ts` keeps a `pages` ref. `loadPages(filter, n)` loads n pages in order, each with the cursor of the page before. `showMore` fetches `data.next`, merges with `mergePages`, increments `pages`, and moves focus to the first new row. `restartPages` resets to 1 on a tab change.
   - **30 s reload:** `useResource` has `pollMs = 30_000` (`lib/use-resource.ts:12`). A filter change reloads through `useReloadOn`.
   - **Row actions:** `delegationActions(status, {owner, canWrite})` in `delegations-view.ts` gives `remind` (owner; `sent` or `overdue`), `done` (`answered` or `overdue`) and `cancel` (owner; `drafted`, `sent` or `overdue`). `Delegations.run` calls `postRemind` and `postDone` in `delegations-api.ts`, all inside `singleFlight`. `cancel` first opens `DelegationCancelDialog`, then `postCancel`. Outcomes (`gone`, `notice`, `error`) come from `remindOutcome`, `doneOutcome` and `cancelOutcome`. `refresh()` reloads the list and `me`.
   - **Focus:** `lib/focused-row.ts` `createFocusedRowTracker(ROW_ID_PREFIX)` tracks the focused `li[id^=prefix]` through document `focusin` and `focusout`. If a reload drops that row, the page shows `dgn_moved` and focuses the status line (`role=status`). `returnFocus` handles the same case when the cancel dialog closes — observed
5. Unit tests (all in `apps/web/src/lib/`, none run):
   - `delegations-view.test.ts` covers `delegationActions` per status, filter and status labels in both languages, `filterOf`, `remindBlock`, outcomes and `mergePages`.
   - `delegations-pages.test.ts` covers `loadPages` (cursor chain, stop at the last page) and `restartPages`.
   - `delegations-components.test.tsx` covers `DelegationRow` (buttons per role, reminder block, drafted link) and `DelegationFilterTabs` (four links, current marked).
   - `focused-row.test.ts` covers the tracker — observed (names only)

Checks: the three named test files cover the pure view logic, paging and row/tab rendering. They do not cover `Delegations.tsx` itself, so the URL, the 30 s poll, the focus flow and the action flow have no unit test (guessed; I saw no test file for `Delegations.tsx` or `use-delegation-filter.ts`). A new per-status column would need new tests for `FILTER_STATUSES` on the server and the web filter list.

## Scout 2

Question: How are the Open loops board and the Delegates page built, which files each owns, which files they share with the Delegations page, and which locators the e2e specs use?

Job: `2026-11-23-f169-scout-2-631363a2`

Packet: How the Open loops board and the Delegates page are built, which files each owns, which files they share with Delegations, and which locators the e2e specs use.
Base: 8c9acfc1e
Verified: `git status --short` -> no output (worktree clean) | the import map comes from `grep "^import"` over the files, run this session.
Unknowns: docs-shots and demo have no locators for these pages. `grep` finds only a comment in `shots.spec.ts:23` that names delegates. `demo/record.spec.ts:221-228` and `lib/demo/steps.ts` use `/delegations?filter=overdue` only. I did not open the rest of `shots.spec.ts`, so I cannot say whether it skips these pages on purpose. All paths below are under `apps/web/`.

1. **Open loops board owners** — observed.
   - `src/components/loops/OpenLoops.tsx` composes the page. It reads `open_loops` and `delegation_pages` from `me.features`.
   - `LoopsBoard.tsx` (294 lines) has the list, actions and dialogs. It renders `<ul aria-label=LOOP_LIST_LABELS>` inside `<section aria-label>`, plus a `role="status"` live region.
   - `LoopRow.tsx` has `WaitingRow`, `PromisedRow` and `DelegatedRow`. `loop-kinds.ts` maps `LoopItem.kind` to a row component.
   - `LoopTabs.tsx` has `LoopTabs` and `LoopFilterTabs`. `LoopConfirmDialog.tsx` is the confirm dialog.
   - `src/lib/loops-view.ts` has tab and filter labels, `LOOP_FILTER_OF_DELEGATION`, `loopActions`, `reasonText` and `loopName`. It also has `tabHref` and `loopFilterHref`, which build the `?tab=` and `?filter=` URLs.
   - Other libs it uses: `loops-api`, `use-loop-list`, `use-loop-view`.
2. **Delegates page owners** — observed.
   - `src/islands/DelegatesPage.tsx` (213 lines) uses `AppShell active="delegations" title="title_delegates"`. It renders `<DelegationTabs current="delegates"/>`, `DelegateList`, `DelegateAddForm`, `DelegateEditDialog` and `DelegateOffDialog`.
   - `DelegateAddForm.tsx` (130 lines) is the add form and `DelegateEditDialog.tsx` (137 lines) is the edit dialog.
   - `DelegateList.tsx` (91 lines) holds a `Switch` and an edit button per row. It exports `switchId` and `editButtonId`.
   - `DelegateOffDialog.tsx` (41 lines) is the turn-off dialog. `TextField.tsx` is shared by the add form and the edit dialog.
   - Libs: `delegates-api`, `delegates-form`.
3. **Shared with the Delegations page** — observed.
   - `DelegationsPage.tsx` renders `OpenLoops` when `open_loops` is on. Otherwise it renders `Delegations`.
   - `DelegationTabs.tsx` is the Delegations/Delegates header (`<nav aria-label=dlg_tabs_label>`, `aria-current="page"`). `OpenLoops` and `Delegations` render it for `current="delegations"`. `DelegatesPage` renders it for `current="delegates"`.
   - `OpenLoops` embeds `Delegations` with `embedded` and a `below` render prop on the Delegated tab. This works only when `delegation_pages` is on. `LoopRow.tsx` and `LoopsBoard.tsx` import `approvalLink` and `dueText` from `lib/delegations-view`.
   - Both pages use `AppShell`, `MeProvider`, `ui/{button,card,skeleton,dialog,badge}`, `lib/single-flight`, `lib/can-write` and `lib/focused-row`.
   - Delegations-only files: `Delegations.tsx` (303 lines), `DelegationRow.tsx`, `delegation-kinds.ts` (`ROW_BY_KIND`), `DelegationFilterTabs.tsx` and `DelegationCancelDialog.tsx`.
4. **Locators in `e2e/tests/*.spec.ts`** — observed. Text keys come from `en.*`. Locators are role- and name-based except where noted.
   - `delegations.spec.ts`: the `/delegations` URLs with `?filter=` (closed, overdue, answered).
     - h1 `title_delegations`, list `dgn_list_label`, button `dgn_remind_for` filled with the name, nav `dgn_filters_label`, dialog `dgn_cancel_title`.
     - Link `dlg_tab_delegations`, text `dlg_state_off`, `dgn_owner_only`, `dgn_empty_*` and `dlg_off`.
     - `locator('[role="status"][tabindex="-1"]')`.
   - `delegates.spec.ts`: `/delegates`.
     - h1 `title_delegates`, nav `dlg_tabs_label`, list `dlg_list_label`, switch and edit button named by helpers (`switchName`, `editName`), dialog `dlg_edit_title`.
     - The one data attribute: `[data-card="add-delegate"]`. Labels `dlg_name`, `dlg_email` and `dlg_tags`.
     - Text `dlg_state_active`, `dlg_state_off`, `dlg_exists`, `dlg_mailbox_address`, `dlg_name_error`, `dlg_email_error`, `dlg_tags_none`, `dlg_owner_only` and `dlg_off`. A role `alert` and a role `status`.
   - `open-loops.spec.ts`: `/delegations`, `?tab=promised`, `?tab=waiting&filter=due`, `?tab=nope`.
     - h1 `title_open_loops`, region `lp_list_${kind}`, nav `lp_tabs_label`, link `dlg_tab_delegates`, the `[role=status][tabindex=-1]` live region.
     - On the Delegated tab: list `dgn_list_label` and heading `lp_list_delegated`. Text `lp_owner_only`, `dgn_empty_open` and a regex `/^Due \d{1,2} \w{3,4} \d{4}/`.
     - Cross-page: textbox `appr_edit_body` and `/approvals?id=`.
   - `loops-panel.spec.ts`: `/activity`, `/settings` and `/mailboxes`. These are not the loops board.
     - `li[data-email-id]`, `[data-card=loops]`, `dla_*`, `lset_*` and `tgc_*` keys.
5. **Locator risk for F169** — guessed. Pebble-look restyling of rows or tabs breaks nothing if the roles, `aria-label`s and text keys stay. The only data attributes are `data-card="add-delegate"` and `[data-card=loops]`. The `role="status"` plus `tabindex="-1"` live region is in both `LoopsBoard.tsx:254` and `Delegations.tsx:263`.

Checks: `delegations.spec.ts`, `delegates.spec.ts` and `open-loops.spec.ts` cover the pages above through roles and `en` keys. I did not run them, per the project rule. They miss the visual look, so no check covers the pebble look.

## Scout 3

Question: How is the Rules page built: the add form, the rule lists and how a rule is removed today, the three cards, and which tests and locators cover it?

Job: `2026-11-23-f169-scout-3-5ddac40c`

Packet: How the Rules page, its add-rule form, rule removal, three cards and test coverage are built at HEAD.
Base: 8c9acfc1e
Verified: `git status --porcelain` in apps/web, run after all reads -> empty output (no file changed in the worktree)
Unknowns: I ran no test. Test lists come from reading files and grep only. For the Pixel 7 and Polish acceptance lines, I did not check whether `polish.spec.ts` covers more than the page title.

1. `apps/web/src/islands/RulesPage.tsx` — `RulesPage` wraps `Rules` in `AppShell`. `Rules` loads the mailboxes with `useResource` and shows a mailbox filter `Select#rules-filter`. `RulesBody` (keyed by the filter) loads rules from `rulesPath(filter)` with `useResource`, and shows `AddRuleForm` only when `isOwner` (`role==="owner" && canWrite(me)`). A non-owner who is not an owner role sees the text `set_owner_only`. It renders one `RuleList` per kind in `ruleKindOrder` (vip, whitelist, blocklist). Cards below the lists:
   - `UrgencyCard` only when `me.features` has `urgency_editor`.
   - `SuggestionsCard` always.
   - `NewslettersCard` only when `me.features` has `bulk_unsubscribe`.
   `rulesVersion` is a counter: an Accept in `SuggestionsCard` raises it and `RulesBody` reloads the list, while `AddRuleForm` keeps its typed text. Shared hooks and helpers: `useResource`, `useNow`, `canWrite`, `useMe`/`reloadMe`, `api`, `t()`. — observed

2. `components/rules/AddRuleForm.tsx` — a `Card[data-card=add-rule]` with a `<form noValidate>`. Fields:
   - Kind: `Select#rule-kind`, from `senderRuleKinds` (vip, whitelist, blocklist), default `vip`. Labels come from `kindTitles`.
   - Pattern: `Input#rule-pattern` with help text `rules_pattern_help`. Error `<p id=rule-pattern-error role=alert>` sets `aria-invalid` and `aria-describedby`.
   - Scope: `Select#rule-scope`, `all` plus one entry per mailbox address. It falls back to `all` if the mailbox leaves the list.
   - Submit: a button `rules_add`, disabled while `pending`.
   Validation is client-side with `ruleBodySchema` (`packages/core/src/web/rules.ts`). The pattern has a max of 254 characters and `isValidSenderPattern`, and an invalid one gives `pattern_invalid`. It POSTs `/api/rules`. Errors: `rule_exists` (409) shows inline `err_rule_exists`; 404 shows toast `err_not_found` and calls `onMissingMailbox`; 400 shows inline `pattern_invalid` or `error_generic`; anything else shows a toast. Success clears the pattern and shows toast `rule_added_toast`. The form has no sentence layout and no per-slot labels. — observed

3. `components/rules/RuleList.tsx` — one `Card[data-kind=<kind>]` per kind. The vip card has `id=rules-vip` (`vipCardId`, the urgency card links to it). Rows are a `ul.divide-y` of pattern plus scope label (`scopeLabel`); an empty list shows `rules_empty`. Removal today has no confirm dialog and no undo: an owner-only ghost icon button (`Trash2`, `aria-label=rules_delete{pattern}`) calls `DELETE /api/rules/:id` at once, then shows toast `rule_deleted_toast` and calls `onDeleted`. A 404 shows `err_not_found` and removes the row anyway. The only confirm dialog on the page is the "Clear all" dialog in `UrgencyCard`. Rows are plain list items, not chips. — observed

4. The cards:
   - `UrgencyCard.tsx` (399 lines) has `Card[data-card=urgency]`, a mailbox `Select`, `UrgencyForm` for owners, and `UrgencyReadOnly`/`VipLine` for members. It has topic and deadline rows with aria-labels `urg_topic_name_label{n}`, `urg_topic_keywords_label`, `urg_deadline_*` and `urg_topic_remove{n}`. Ended deadlines get `data-ended`. It also has a Clear-all `Dialog`, `useDraft`/`isDirty`, and `settingsPath`.
   - `SuggestionsCard.tsx` has `Card[data-card=suggestions]`, a mailbox `Select`, and `SuggestionRows` with `data-pattern` and `data-suggestion-kind`. Buttons are `sg_accept_for{pattern}` and `sg_dismiss_for{pattern}`. It uses a `Badge` and `kindTitles`, and calls `onRulesChanged`.
   - `NewslettersCard.tsx` has `Card[data-card=newsletters]`, a mailbox `Select`, and `NewsletterRows` with `data-sender` and `data-method`. Buttons are `nl_unsubscribe_for{sender}` and `nl_open_link_for{sender}`. Failures show toasts.
   The three cards share the `useResource`, `Card`/`Select`/`Skeleton` and `toast` pattern and take `mailboxes` plus `isOwner` from the page. — observed

5. Coverage:
   - **e2e, main spec** `apps/web/e2e/tests/rules.spec.ts` has one test, "add, a duplicate, a bad pattern, delete". Locators:
     - `[data-card=add-rule]` and `[data-kind=vip]`.
     - `getByRole("combobox", {name: rules_kind_label | rules_scope_label})`.
     - `getByLabel(rules_pattern_label, {exact:true})`.
     - `getByRole("button", {name: rules_add})`.
     - `getByRole("alert")` for `err_rule_exists` and `pattern_invalid`.
     - `getByRole("button", {name: t("rules_delete",{pattern})})`.
     - Toast texts `rule_added_toast` and `rule_deleted_toast`, plus `expectNoA11yViolations`.
   - **e2e, other specs** use the page: `account.spec.ts:40-43` (member has no `rules_add` button), `polish.spec.ts:62` (title only), `urgency.spec.ts` (`[data-card=urgency]`, aria-label locators, `[data-ended=true]`), `newsletters.spec.ts` and `suggestions.spec.ts` (`[data-card=...]`; suggestions also uses `getByLabel(rules_pattern_label)` at line 70). `e2e/docs-shots/shots.spec.ts:32` shoots `/rules`.
   - **Unit** (bun test): `src/lib/rules-view.test.ts` (groupRules, scopeLabel, rulesPath, kindTitles), `urgency-card.test.tsx`, `newsletters-view.test.tsx`, `suggestions-view.test.tsx`, and `packages/core/src/web/rules.test.ts` for the schema.
   - **Integration**: `apps/server/test/integration/web-rules.test.ts` and `web-suspended.test.ts`.
   No unit test renders `AddRuleForm` or `RuleList`. A rule-form redesign must keep the `rules.spec.ts` locators (the labels, `data-card=add-rule`, `data-kind`, the role alert) or change that spec. — observed

Checks: `rules.spec.ts` covers add, duplicate, bad pattern, delete and a11y on the page; it misses the blocklist and whitelist kinds, the mailbox scope select with a real mailbox, Polish text, mobile layout of the form, and any undo or confirm on delete (none exists).

## Scout 4

Question: Where do the text keys of the four pages live, how do Polish plurals work, which user docs pages describe the pages, which F166 stages are on HEAD, and how does AppShell pick the Open loops title?

Job: `2026-11-23-f169-scout-4-b454dcb0`

Packet: Where the text keys of the Delegations, Delegates, Open loops and Rules pages live, how plurals work, which docs pages cover them, which F166 stages are on HEAD, and how AppShell picks the Open loops title.
Base: 8c9acfc1e
Verified: `git status --short` -> empty (no file changed); `grep -ril pebble apps/web/src` -> no output
Unknowns: Key counts are keys named in `t("…")` or `tp("…")` calls in each component folder. Keys passed through variables or tables (for example `loop-kinds.ts` and `delegation-kinds.ts`) are not counted. Treat the counts as a lower bound. The docs pages that show the Delegates and Open loops pages by name or screenshot were not found; only text mentions were grepped.
1. **Text key files.** Observed. `apps/web/src/i18n/en.ts` and `pl.ts` only spread group files from `apps/web/src/i18n/texts/` (`en-<group>.ts`, `pl-<group>.ts`). `groups.test.ts` checks that no key repeats across groups. None of the four pages has its own group.
   - Page titles: `en-approvals.ts:192, 283, 291, 292` (`title_open_loops`, `title_rules`, `title_delegates`, `title_delegations`). Polish: `pl-approvals.ts:194, 286, 294, 295`.
   - Delegations and Delegates keys (`dgn_*`, `dlg_*`): `en-approvals.ts`. This group holds 356 keys in total, 189 of them with the `dgn`, `dlg`, `lp` or `lset` prefix. A few shared keys sit in `en-auth.ts` (retry) and `en-mailboxes.ts` (2 keys).
   - Open loops keys (`lp_*`): `en-approvals.ts`.
   - Rules keys: `en-settings.ts` (`urg_*` 23, `nl_*` 16, `rule_*` and `rules_*` 11), `en-suggestions.ts` (`sg_*` 10), plus `en-approvals.ts` and one key in `en.ts`.
2. **Counts per page folder.** Observed.
   - `components/delegation/` (the Delegations and Delegates pages together): 50 keys (25 `dgn`, 22 `dlg`, plus cancel, retry and save).
   - `components/loops/`: 18 keys (15 `lp`, plus retry, one `dlg` key and one `dgn` key).
   - `components/rules/`: 65 keys (23 `urg`, 16 `nl`, 10 `sg`, 9 `rules`, 2 `rule`, plus set, save and retry).
3. **Polish plurals.** Observed.
   - `en.ts` exports `enPlurals` with the forms `one` and `other`. `pl.ts` exports `plPlurals` with `one`, `few` and `many`.
   - `tp(key, count, vars)` is in `i18n/index.ts:84`. It uses `pluralCategory(locale, count)` from `@ea/core/web` to pick the form, and it fills `{count}`.
   - Both tables are typed `Record<PluralKey, …>` (`index.ts` `PluralTables`), so a key missing in one locale is a type error.
   - Plural keys for these pages:
     - Open loops: `lp_working_days` (`en.ts`; `pl.ts:52` is "1 dzień roboczy / {count} dni robocze / {count} dni roboczych").
     - Rules: `nl_count`, called from `components/rules`.
     - Settings: `lset_wait_days`, used in `LoopSettingsCard.tsx:65`. It is not on these pages.
     - Delegations and Delegates components call no `tp`.
4. **Open loops title.** Observed.
   - `islands/DelegationsPage.tsx` renders `<AppShell active="delegations" title="title_delegations">` and shows `<OpenLoops />` when `me.features` includes `open_loops`.
   - `components/shell/nav-items.ts:71`: `pageTitle(active, title, features)` returns `"title_open_loops"` when `active === "delegations"` and the features include `open_loops`. Otherwise it returns the title it got.
   - `AppShell.tsx:55` calls it once the `me` data has loaded. The nav label uses the same flag (`nav-items.ts:61`, `nav_open_loops`).
   - `pages/delegations.astro` passes `titleKey="title_delegations"`, so the document title keeps the old text.
   - `pages/delegates.astro` uses `title_delegates` and the island `DelegatesPage.tsx`. `RulesPage.tsx` is in `islands/`.
5. **F166 stages on HEAD.** Observed: none are built.
   - The last F166 commits are the plan and the move to the active lane (`8c9acfc1e`, `9b0e48235`). The Pebble mockup is `94092626b`.
   - `apps/web/src/components/` has no `patterns/` folder and no `PageHead.tsx`.
   - `AppShell.tsx` has no `lead` or `action` prop (grep returned nothing).
   - `global.css` last changed in `f79645f33`, a comment-only edit with no tokens.
   - All 11 stage files (`stage-01-records.md` through `stage-11-dark-scan.md`) are still to do.
6. **User docs.** Observed, under `apps/docs/src/content/docs/`.
   - `how-to/delegate-and-follow-up.mdx` and `pl/how-to/delegate-and-follow-up.mdx` describe Delegations and Delegates. They state "You cannot add a delegate in the panel", which looks out of date because `DelegateAddForm.tsx` exists. Guessed.
   - `how-to/sender-rules.mdx` and `pl/how-to/sender-rules.mdx` describe Rules and use `<Shot page="rules" />` at line 28 and `<UiText k="…" />` keys.
   - Other pages mention the four pages: `reference/settings.mdx`, `start/index.mdx` (en and pl) and `faq.mdx`.
   - No page matched "open loops" or "otwarte sprawy". The Open loops page has no docs page.
Checks: `apps/web/src/i18n/texts/groups.test.ts` covers key uniqueness across groups. `i18n/open-loops.test.ts` and `i18n/i18n.test.ts` exist for the loops texts and the plural tables. I did not run any of them.

