# s5c-web-settings-rules — Stage 7

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 7 — Web foundations: `ApiError.raw`, the helpers, `textarea`, the lint scope, the strings

Two steps. No page yet; stages 8–10 use what this stage adds.

- [x] **7.1 `ApiError.raw`, the error map, `gate-text`, `draft`, `timezones`, `textarea`, the lint scope (B11)**
  - Goal: the pages get tested helpers for the 409 gate, the texts of a gate row, the form drafts under polling and the time-zone search.
  - Files: change `apps/web/src/lib/api.ts`, `api.test.ts`, `apps/web/src/lib/errors.ts`, `errors.test.ts`, `eslint.config.js`; create `apps/web/src/lib/gate-text.ts`, `gate-text.test.ts`, `apps/web/src/lib/draft.ts`, `draft.test.ts`, `apps/web/src/lib/timezones.ts`, `timezones.test.ts`; add `apps/web/src/components/ui/textarea.tsx` with the shadcn CLI.
  - Interfaces:

    ```ts
    // lib/api.ts
    export class ApiError extends Error {
      constructor(
        readonly status: number,
        readonly code: string,
        message?: string,
        readonly details?: { path: string; code: string; message: string }[],
        readonly raw: Record<string, unknown> = {} // the parsed error body when it is a JSON object
      );
    }

    // lib/gate-text.ts
    import type { GateView } from "@ea/core/web";
    export function formatPercent(ratio: number): string; // the bar: 0.985 → "98.5"; 1 → "100"; 0.98 → "98"
    export function formatPrecision(ratio: number): string; // a measured precision, rounded down: 0.9796 → "97.9"; 0.985 → "98.5"; 1 → "100"
    export function formatConfidence(value: number): string; // 0.5 → "0.5"; 0.85 → "0.85"
    export function gateText(gate: GateView, bar: number, minKept: number): { key: TextKey; vars: Record<string, string | number> };

    // lib/draft.ts
    export interface Draft<T> { server: T; value: T }
    export function startDraft<T>(server: T): Draft<T>;
    export function nextDraft<T>(draft: Draft<T>, server: T): Draft<T>; // takes the new server value only while value equals the old server value
    export function isDirty<T>(draft: Draft<T>): boolean;

    // lib/timezones.ts
    export function filterTimeZones(list: readonly string[], query: string, current: string): string[];
    ```

  - Decisions:
    - `readError` keeps the parsed body as `raw` when it is a plain object (also when `apiErrorSchema` refuses it, then with code `internal` as today). Nothing else changes in `createApi`.
    - `errors.ts` adds `rule_exists` → `err_rule_exists`, `rule_limit` → `err_rule_limit`, `not_found` → `err_not_found`.
    - `gateText`: `go` → `gate_go` with `{ precision: formatPrecision(precision ?? 0), kept, at: formatConfidence(atConfidence), bar: formatPercent(bar) }`; `no-go` → `gate_no_go` with the same vars; `no-go: too few` → `gate_too_few` with `{ kept, minKept, at }`. `formatPercent` rounds to one decimal and drops a trailing `.0` (`Number((ratio * 100).toFixed(1)).toString()`); `formatPrecision` uses `Math.floor(Math.round(ratio * 1e6) / 1e3) / 10` (the inner round removes float noise such as `0.836 * 1000 = 835.99…`), so a failing precision never shows the bar's number (cold review finding 7); the UI language is English, so the decimal point is `.`.
    - `draft.ts`: equality by `JSON.stringify` (the values are strings, string arrays or `null`). `nextDraft({ server: a, value: a }, b)` → `{ server: b, value: b }`; `nextDraft({ server: a, value: x }, b)` with `x ≠ a` → `{ server: b, value: x }` (the user's typing stays; after a save the page calls `startDraft(saved)`).
    - `filterTimeZones`: `q = query.trim().toLowerCase().replaceAll(" ", "_")`; empty → the first 50 of the list; else the names whose lower case contains `q`, at most 50; `current` first when it matches the query or the query is empty (also when the list lacks it); no duplicates; the cap of 50 includes `current`.
    - Textarea: `cd apps/web && bunx --bun shadcn@latest add textarea` (the S5a and S5b way); then `git diff --exit-code bun.lock apps/web/package.json` must pass (B16); if the CLI changes a package, stop and ask the user.
    - `eslint.config.js`: the `react/jsx-no-literals` block adds `apps/web/src/components/settings/**/*.tsx` and `apps/web/src/components/rules/**/*.tsx`.
  - Test (unit, `bun test`):
    1. `api.test.ts`: a 409 `{ error: "no_go", gate: { decision: "no-go", … } }` → `ApiError` with `code` `no_go`, `raw.gate` equal to the sent object; a 500 with a text body → `raw` `{}`.
    2. `errors.test.ts`: the three new codes map to their keys.
    3. `gate-text.test.ts`: `go` `{ precision: 0.985, kept: 62, atConfidence: 0.85 }`, bar 0.98 → `gate_go` with `{ precision: "98.5", kept: 62, at: "0.85", bar: "98" }`; `no-go` `{ precision: 0.836, kept: 55, atConfidence: 0.5 }` → `gate_no_go` with `precision: "83.6"`, `at: "0.5"`; `no-go: too few` `{ kept: 12, atConfidence: 0.5 }`, minKept 30 → `gate_too_few` with `{ kept: 12, minKept: 30, at: "0.5" }`; `formatPercent(1)` → `"100"`; `formatPrecision(0.9796)` → `"97.9"` and `gateText` of a `no-go` with precision 0.9796 shows `97.9`.
    4. `draft.test.ts`: the two cases above; `isDirty`; arrays (`["08:00"]` vs `["08:00"]` is not dirty).
    5. `timezones.test.ts` with the list `["Europe/Warsaw", "Europe/London", "America/New_York", "UTC"]`: query `new york` → `["America/New_York"]`; `europe` with current `Europe/London` → `["Europe/London", "Europe/Warsaw"]`; `""` with current `Asia/Tokyo` (not in the list) → `Asia/Tokyo` first, then the four; 60 names (not containing `Asia/Tokyo`), `""` and current `Asia/Tokyo` → 50 results with `Asia/Tokyo` first.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; `git diff --exit-code bun.lock apps/web/package.json`.
  - Done when: the tests pass; `apps/web/src/components/ui/textarea.tsx` exists; no package change.
  - Out of scope: the strings (7.2); the pages.

- [x] **7.2 The strings of S5c (`en.ts`; U1, S4–S9, B12–B14)**
  - Goal: every text of stages 8–10 is a key, so the page stages only use them.
  - Files: change `apps/web/src/i18n/en.ts`.
  - Decisions: add these keys after the S5b block, under a comment `// S5c: settings` and `// S5c: rules` (the texts are final; a page stage that needs one more key adds it in its own step). Existing keys that S5c reuses: `save`, `cancel`, `retry`, `refresh`, `updated_at`, `owner_only`, `error_generic`, `error_too_many`, `new_password_label`, `repeat_password_label`, `password_help`, `password_too_short`, `password_too_long`, `passwords_differ`, `password_required`, `title_settings`, `title_rules`, the status and scope badge keys of S5b.

    | Key                         | Text                                                                                                                                                                                           |
    | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `set_mailbox_label`         | Mailbox                                                                                                                                                                                        |
    | `set_no_mailbox`            | No mailbox yet.                                                                                                                                                                                |
    | `set_open_mailboxes`        | Open Mailboxes                                                                                                                                                                                 |
    | `set_owner_only`            | Only the owner can change this.                                                                                                                                                                |
    | `set_load_error`            | Could not load the settings.                                                                                                                                                                   |
    | `set_section_general`       | Your account and the organization                                                                                                                                                              |
    | `mode_title`                | Mode and actions                                                                                                                                                                               |
    | `mode_shadow`               | Shadow mode                                                                                                                                                                                    |
    | `mode_shadow_text`          | The assistant changes nothing in this mailbox. It reports what it would do.                                                                                                                    |
    | `mode_assist`               | Assist mode                                                                                                                                                                                    |
    | `mode_assist_text`          | The assistant moves, marks and flags mail by the switches below. Nothing is sent without your approval.                                                                                        |
    | `mode_to_assist`            | Switch to assist                                                                                                                                                                               |
    | `mode_to_shadow`            | Switch to shadow                                                                                                                                                                               |
    | `mode_assist_toast`         | Assist mode is on.                                                                                                                                                                             |
    | `mode_shadow_toast`         | Shadow mode is on. The assistant changes nothing now.                                                                                                                                          |
    | `moves_unsupported`         | This mail server cannot move mail. Moves stay in the log only.                                                                                                                                 |
    | `switch_move`               | Move mail (categories with auto on)                                                                                                                                                            |
    | `switch_mark_read`          | Mark as read (categories with auto on)                                                                                                                                                         |
    | `switch_flag`               | Flag urgent mail                                                                                                                                                                               |
    | `switch_create_draft`       | Write delegation drafts (sent only after your approval)                                                                                                                                        |
    | `switch_move_unsure`        | Move mail the assistant is unsure about                                                                                                                                                        |
    | `switch_on_toast`           | {name}: on.                                                                                                                                                                                    |
    | `switch_off_toast`          | {name}: off.                                                                                                                                                                                   |
    | `expired_suffix`            | {count} planned actions were cancelled.                                                                                                                                                        |
    | `assist_title`              | Switch to assist mode?                                                                                                                                                                         |
    | `assist_text`               | In assist mode the assistant changes mail in {address} for the categories with auto on. Nothing is sent without your approval.                                                                 |
    | `assist_usual`              | Turn on the usual switches                                                                                                                                                                     |
    | `assist_usual_hint`         | Move, mark as read and flag go on. Move unsure goes off. Drafts stay as they are.                                                                                                              |
    | `assist_keep`               | Keep my switches                                                                                                                                                                               |
    | `assist_keep_hint`          | On now: {list}.                                                                                                                                                                                |
    | `assist_none_on`            | none                                                                                                                                                                                           |
    | `cat_title`                 | Categories                                                                                                                                                                                     |
    | `cat_help`                  | With auto on, the assistant acts on a category by itself. A category must first pass the check: {bar} % precision on at least {minKept} mails you rated. Rate mails with ✅ or ✏️ in Telegram. |
    | `cat_urgent`                | Urgent                                                                                                                                                                                         |
    | `cat_needs_reply`           | Needs reply                                                                                                                                                                                    |
    | `cat_info`                  | Info                                                                                                                                                                                           |
    | `cat_notification`          | Notifications                                                                                                                                                                                  |
    | `cat_spam`                  | Spam                                                                                                                                                                                           |
    | `cat_effect_urgent`         | Auto changes nothing here: urgent mail only gets a flag (the Flag switch).                                                                                                                     |
    | `cat_effect_needs_reply`    | Auto changes nothing here: mail that needs a reply stays in INBOX.                                                                                                                             |
    | `cat_effect_info`           | Auto on: info mail moves out of INBOX.                                                                                                                                                         |
    | `cat_effect_notification`   | Auto on: notifications are marked as read and move out of INBOX.                                                                                                                               |
    | `cat_effect_spam`           | Auto on: spam moves out of INBOX.                                                                                                                                                              |
    | `cat_auto_label`            | Auto for {category}                                                                                                                                                                            |
    | `cat_threshold`             | Threshold {value}                                                                                                                                                                              |
    | `gate_go`                   | Passed: precision {precision} % on {kept} rated mails at confidence ≥ {at} (bar {bar} %).                                                                                                      |
    | `gate_no_go`                | Not passed: precision {precision} % on {kept} rated mails at confidence ≥ {at} (bar {bar} %).                                                                                                  |
    | `gate_too_few`              | Not enough rated mails: {kept} of {minKept} needed at confidence ≥ {at}.                                                                                                                       |
    | `auto_on_toast`             | Auto is on for {category}.                                                                                                                                                                     |
    | `auto_off_toast`            | Auto is off for {category}.                                                                                                                                                                    |
    | `anyway_title`              | Set auto anyway?                                                                                                                                                                               |
    | `anyway_text`               | {category} did not pass the check. The assistant would move and mark {category} mail on its own. You can undo a move for 7 days. Switch auto off again at any time.                            |
    | `anyway_submit`             | Set anyway                                                                                                                                                                                     |
    | `folders_title`             | Synced folders                                                                                                                                                                                 |
    | `folders_always`            | Always synced                                                                                                                                                                                  |
    | `folders_note`              | Turning a folder on again starts a new first sync of it.                                                                                                                                       |
    | `folders_only_inbox`        | Only INBOX is synced. Other folders show here when the mail server lists them.                                                                                                                 |
    | `folder_inbox`              | Inbox                                                                                                                                                                                          |
    | `folder_offers`             | Offers                                                                                                                                                                                         |
    | `folder_social`             | Social                                                                                                                                                                                         |
    | `folder_bills`              | Bills                                                                                                                                                                                          |
    | `folder_junk`               | Junk                                                                                                                                                                                           |
    | `folder_on_toast`           | {folder}: synced.                                                                                                                                                                              |
    | `folder_off_toast`          | {folder}: not synced.                                                                                                                                                                          |
    | `digest_title`              | Digest times (yours)                                                                                                                                                                           |
    | `digest_help`               | When your Telegram digests come, in the organization timezone ({timezone}). Up to 6 times.                                                                                                     |
    | `digest_none`               | No times: you get no digests.                                                                                                                                                                  |
    | `digest_time_label`         | Digest time {n}                                                                                                                                                                                |
    | `digest_remove`             | Remove digest time {n}                                                                                                                                                                         |
    | `digest_add`                | Add time                                                                                                                                                                                       |
    | `digest_new_time_note`      | A new time that passed less than 6 hours ago today sends a digest at once.                                                                                                                     |
    | `digest_saved_toast`        | Digest times saved.                                                                                                                                                                            |
    | `time_invalid`              | Use the form HH:MM.                                                                                                                                                                            |
    | `times_too_many`            | At most 6 times.                                                                                                                                                                               |
    | `times_duplicate`           | Use each time only once.                                                                                                                                                                       |
    | `sig_title`                 | Signature                                                                                                                                                                                      |
    | `sig_help`                  | Added at the end of the messages that the assistant writes for you from now on (delegations, questions, reminders). Empty: your display name.                                                  |
    | `sig_label`                 | Signature text                                                                                                                                                                                 |
    | `sig_counter`               | {count} / 500                                                                                                                                                                                  |
    | `sig_saved_toast`           | Signature saved.                                                                                                                                                                               |
    | `style_too_long`            | Use at most 500 characters.                                                                                                                                                                    |
    | `style_bad_char`            | Remove the special characters.                                                                                                                                                                 |
    | `tz_title`                  | Timezone                                                                                                                                                                                       |
    | `tz_current`                | Now: {timezone}                                                                                                                                                                                |
    | `tz_search_label`           | Search time zones                                                                                                                                                                              |
    | `tz_list_label`             | Timezone                                                                                                                                                                                       |
    | `tz_no_match`               | No time zone matches.                                                                                                                                                                          |
    | `tz_note`                   | Digest times, the quiet hours (22:00–07:00) and the 07:30 reminder run follow this zone. A change applies within a minute. On that day digests can be skipped, come later or come at once.     |
    | `tz_saved_toast`            | Timezone saved: {timezone}.                                                                                                                                                                    |
    | `timezone_invalid`          | The server does not know this time zone.                                                                                                                                                       |
    | `retention_line`            | Mail data is kept for {days} days.                                                                                                                                                             |
    | `acct_title`                | Account                                                                                                                                                                                        |
    | `acct_current_label`        | Current password                                                                                                                                                                               |
    | `acct_revoke_others`        | Sign out my other devices                                                                                                                                                                      |
    | `acct_change`               | Change password                                                                                                                                                                                |
    | `acct_changing`             | Changing…                                                                                                                                                                                      |
    | `acct_wrong_current`        | The current password is wrong.                                                                                                                                                                 |
    | `acct_changed_toast`        | Password changed.                                                                                                                                                                              |
    | `acct_changed_others_toast` | Password changed. Your other devices are signed out.                                                                                                                                           |
    | `acct_sign_out_all`         | Sign out everywhere                                                                                                                                                                            |
    | `acct_sign_out_all_help`    | Ends every session of your account, also this one.                                                                                                                                             |
    | `rules_filter_label`        | Show rules for                                                                                                                                                                                 |
    | `rules_all_mailboxes`       | All mailboxes                                                                                                                                                                                  |
    | `rules_add_title`           | Add a rule                                                                                                                                                                                     |
    | `rules_kind_label`          | Kind                                                                                                                                                                                           |
    | `rule_kind_vip`             | VIP                                                                                                                                                                                            |
    | `rule_kind_whitelist`       | Whitelist                                                                                                                                                                                      |
    | `rule_kind_blocklist`       | Blocklist                                                                                                                                                                                      |
    | `rules_vip_text`            | Never spam, never moved or marked as read.                                                                                                                                                     |
    | `rules_whitelist_text`      | Never spam.                                                                                                                                                                                    |
    | `rules_blocklist_text`      | Always spam, unless the sender is also on the whitelist or VIP.                                                                                                                                |
    | `rules_pattern_label`       | Address or domain                                                                                                                                                                              |
    | `rules_pattern_help`        | An address (anna@firma.pl) or a domain (firma.pl). A domain also covers its subdomains.                                                                                                        |
    | `pattern_invalid`           | Enter an address like anna@firma.pl or a domain like firma.pl.                                                                                                                                 |
    | `rules_scope_label`         | Applies to                                                                                                                                                                                     |
    | `rules_scope_removed`       | Removed mailbox                                                                                                                                                                                |
    | `rules_add`                 | Add rule                                                                                                                                                                                       |
    | `rules_empty`               | No rules here.                                                                                                                                                                                 |
    | `rules_delete`              | Delete the rule {pattern}                                                                                                                                                                      |
    | `rules_load_error`          | Could not load the rules.                                                                                                                                                                      |
    | `rule_added_toast`          | Rule added.                                                                                                                                                                                    |
    | `rule_deleted_toast`        | Rule deleted.                                                                                                                                                                                  |
    | `err_rule_exists`           | This rule exists already.                                                                                                                                                                      |
    | `err_rule_limit`            | You have reached the limit of 1000 rules.                                                                                                                                                      |
    | `err_not_found`             | It is gone already.                                                                                                                                                                            |

    The VIP text follows `decidePolicy` (`packages/core/src/triage/policy.ts`: a VIP mail is never moved or marked as read) and `applyHardRules` (`triage/rules.ts`: a VIP is whitelisted; a blocklisted sender that is also whitelisted is not spam). The category effect texts follow `planActions` (`triage/planners.ts:143-160`).

  - Test: `bun run typecheck` (every key is a `TextKey`); no unit test for plain strings.
  - Check: `bun run lint && bun run typecheck && cd apps/web && bun run build`.
  - Done when: the keys exist with these texts.
  - Out of scope: the components.
