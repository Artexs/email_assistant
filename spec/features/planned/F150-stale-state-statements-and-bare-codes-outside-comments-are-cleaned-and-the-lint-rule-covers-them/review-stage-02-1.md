PASS 3ab52b7054dbdb98a1f3f28ab735609987afa4c9

Reviewed commit `3ab52b70` (F150 stage 02: the docs flag guard lists the real texts). `git rev-parse HEAD` returns that commit (`/tmp/f150-review-probe/head.log`). The tree was clean. The candidate changes two files: `apps/docs/src/flagged-text.ts` and `apps/docs/src/flagged-text.test.ts`.

## Blocking findings

None.

## Unverified

- I ran no test suite, as the task required. I did not run `bun test apps/docs/src/flagged-text.test.ts` either. The probes below cover its page, claim and changelog scans, its T2 coverage rule and its bot-literal source rule. The new `test.each` rows and their break check were checked only by reading them. A row fails if its entry is removed, because each row expects the `<flag>:` prefix with `toContainEqual`.

## Checks run

1. **Install.** `bun install --frozen-lockfile` with bun 1.4.4, which matches `.bun-version`. It installed 991 packages.
2. **Each entry alone over the docs pages.** The probe is `/tmp/f150-review-probe/probe.ts`, outside the repo; its output is in `/tmp/f150-review-probe/probe.log`. It ran `flaggedTextProblems(source, [entry], () => false)` over 93 sources: every `.md`/`.mdx` under `apps/docs/src/content/docs`, the changelog page from `changelogPage(CHANGELOG.md)`, and the en and pl text and condition of every public claim. The result is **hits=0 for all 18 moved entries**:
   - `delegate_button`: `dla_title` and `dla_select_placeholder`, English and Polish.
   - `trust_ladder`: `rep_intro` and `rep_recommended`.
   - `reply_drafts`: `switch_reply_drafts`, plus the two `sendLineEditable` literals.
   - `draft_copy_check`: the two `sendLineEditable` literals.
   - `web_push`: `push_title` and `push_devices_title`.
   - As a control, `en.dla_button` ("Delegate") hits 12 sources, so the probe can tell a common word from a UI phrase. The full `FLAGGED_TEXT` list over all 93 sources gives 0 hits, so no docs page needed a rewrite.
3. **Coverage.** The probe `/tmp/f150-review-probe/cover.ts` (output in `cover.log`) finds no default-off flag without text or a reason. `NO_VISIBLE_TEXT` is `{}`, so it holds no `STRING_CODE` match.
4. **The `draft_copy_check` OR rule (proven by reading the code).**
   - `packages/core/src/digest/approvals.ts:148` (`/tmp/f150-review-probe/orrule.log`) shows `sendLineEditable` when `view.kind === "reply" || view.copyCheck === true`.
   - `apps/server/src/modules/channels/notices/approval.ts:128` sets `copyCheck` only while `draft_copy_check` is on.
   - Reply cards depend on `reply_drafts` (`actions/approvals.ts:156`).
   - Both flags list `"edit and send in your mail client"` and `"edytuj i wyślij w programie pocztowym"`. Both literals stand in `packages/core/src/texts/approvals-en.ts:51` and `approvals-pl.ts:63`, so the T2 bot-literal rule holds.
5. **Each panel entry shows only while its flag is on (proven by reading the code).**
   - `dla_*` renders only in the `DelegateAction` dialog. That dialog needs `delegate_button` and `delegation_pages` (`apps/web/src/lib/delegate-action.ts` `delegateHintWanted`).
   - `rep_intro` and `rep_recommended` render only in `ReportContent`. `islands/ReportPage.tsx:121` shows `rep_off` instead while `trust_ladder` is off.
   - `switch_reply_drafts` renders only when the settings view has `toolSwitches.reply_drafts` (`components/settings/ModeCard.tsx:71`). The server adds that field only while the flag is on (`config/routes.ts:140`).
   - `push_title` and `push_devices_title` render only in `PushDevicesCard`. `islands/SettingsPage.tsx:173` mounts that card only with `web_push`.

## Notes

- **Board drift, proven by grep (`/tmp/f150-review-probe/f115.log`). The coordinator must tell F115.** The stage moves `draft_copy_check` out of `NO_VISIBLE_TEXT`. The reply drafts docs stage, `spec/features/active/F115-e6a-reply-drafts/stages/stage-17-docs.md:27`, still points to `NO_VISIBLE_TEXT.draft_copy_check` for the reason. That key no longer exists. The texts are now in `FLAGGED_BOT_TEXT.draft_copy_check`.
- **Stale-prone comment, plausible.** `flagged-text.ts` now says "Every flag has text now; a new flag with none gets its reason here." This is a state statement of the kind this ticket removes. It becomes false when a later flag gets a reason, and nothing makes the author edit it. Better: drop the first clause.
- **"Reply drafts" also appears in flag-off texts, plausible.** The entry `switch_reply_drafts` ("Reply drafts" / "Szkice odpowiedzi") occurs inside texts that show with the flag off: `tg_consent_text` (the legal consent text), `appr_feature_off` and others. The probe at `/tmp/f150-review-probe/sub.ts` found them. No docs page holds these texts today (0 hits). A future page that quotes the Telegram consent text with `<UiText k="tg_consent_text" />` would fail the scan, although the flag does not gate that text. The entry still meets plan D15: it is a two-word switch label. This is friction for later, not a break.
- **Entry shape.** `rep_intro` is a full sentence, not a title or a switch label as plan D15 describes. It passes the "only when quoting the UI" test (0 hits), so it is acceptable.
- **Test shape.** The new rows form one `test.each` table with exact `toContainEqual` values. Each row reads `en[key]`, so a text change does not break it. It does not copy an existing case, and it follows `docs/code-patterns.md` § Tests.
- **Scope.** The diff (`/tmp/f150-review-probe/diff.log`) has no change outside the two guard files: no page rewrite, no flag default change and no change to the scan logic. The commit message has no bare code.

## Note check

- HEAD is 3ab52b70 and each moved flag's entries show only while the flag is on: proven. Evidence: `/tmp/f150-review-probe/head.log`, plus the gating code at `apps/web/src/lib/delegate-action.ts`, `apps/web/src/islands/ReportPage.tsx:121`, `apps/web/src/components/settings/ModeCard.tsx:71` and `apps/web/src/islands/SettingsPage.tsx:173`.
- Each moved entry alone fails no docs page: proven. Evidence: `/tmp/f150-review-probe/probe.log` (18 moved entries hits=0; control `dla_button` hits=12).
- The sendLineEditable OR rule lists the text under both flags: proven. Evidence: `/tmp/f150-review-probe/orrule.log` and `/tmp/f150-review-probe/diff.log`.
- A test row per moved flag, and NO_VISIBLE_TEXT free of STRING_CODE: proven. Evidence: `/tmp/f150-review-probe/diff.log` (5 rows; `NO_VISIBLE_TEXT = {}`) and `/tmp/f150-review-probe/cover.log`.
- Easy-to-miss rule "Run no suite.": followed. Only the one-off probes in `/tmp/f150-review-probe/` and `bun install --frozen-lockfile` ran. No `bun test`, lint, typecheck or `check:job` ran. No log can prove a command did not run, so this rests on the commands of this job.
- Reminder "tests run once per job; no test:unit, test:int or test:e2e": followed. None ran.
- Reminder "check:job for a job that commits product code": does not apply. This review made no commit.
- Reminder "a review job runs no test suite, lint or typecheck": followed. None ran. No single test file ran either.
- Reminder "never delete node_modules/.cache": followed. It was not touched.

Decisions for the owner: none.
