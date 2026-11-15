# F115 stage 06 — Eligibility facts

Part of [`../plan.md`](../plan.md). Needs 03b. May build next to 04–05.

Builds the pure rule `replyEligibility` and the readers that fill `ReplyFacts` (`interfaces.md`), including the three-state suspicion reader that F109 review-4 N3 asks for.

## Step 1 — The rule (core)

- **Goal:** `replyEligibility(facts, { trigger, now })` in `packages/core/src/replies/eligibility.ts`.
- **Decisions:** D4; PD-071; notes §3.1. Order of the checks (the first failure is the reason): `not_checked` (not triaged, or `headers` null) → `suspicious` (state `flagged`; every trigger) → `junk_source` → `own_mailbox` (sender is an own mailbox of the org) → `not_a_person` (`isNoreplyAddress`, `listId` or `listUnsubscribe` set, `autoSubmitted` set and not `no`, `precedence` in `bulk`, `list`, `junk`) → `calendar` → `answered` → for `auto` only: `category` (not `needs_reply`), `too_old` (`receivedAt` older than 7 days), `language` (`other`). A `tap`, `redraft` or `sample` with language `other` answers ok with the language of the owner's locale (null = `pl`). `open_newer` is set by the job (stage 07), not here.
  - Untriaged mail: state `untriaged` → `not_checked`, also on tap. A clean mail: `clean` → passes.
- **Test (unit, table of fixed facts):**
  1. A clean person mail, `needs_reply`, pl, 2 days old → ok, `pl`.
  2. The same, `suspicion: { state: "untriaged" }` → `not_checked`; `headers: null` → `not_checked`.
  3. `flagged` with `reply_to_mismatch` on `tap` → `suspicious`.
  4. `listId: "news.x"` → `not_a_person`; `autoSubmitted: "no"` → ok; `autoSubmitted: "auto-replied"` → `not_a_person`; `precedence: "bulk"` → `not_a_person`.
  5. `fromAddress` = an own address → `own_mailbox`.
  6. `hasCalendar` → `calendar`; `answered` → `answered`.
  7. `auto`, category `info` → `category`; `tap`, category `info` → ok.
  8. `auto`, 8 days old → `too_old`; `tap`, 8 days old → ok.
  9. `auto`, language `other` → `language`; `tap`, `other`, owner locale `en` → ok, `en`.

## Step 2 — Three-state suspicion (triage)

- **Goal:** `suspicionOf(db, ctx, emailIds)` in module `triage`, exported by its index: every id is in the map; no `triage_results` row → `untriaged`; newest row with empty `suspicious_reasons` → `clean`; else `flagged` with the codes. It ignores the `suspicious_mail` flag.
- **Decisions:** keep `suspiciousReasonsOf` as it is (other callers). Ids in chunks of 500; no ids, no query.
- **Test (integration):**
  1. Three mails: no row, a clean row, a row with `auth_fail` → `untriaged`, `clean`, `flagged [auth_fail]`.
  2. A mail with an old flagged row and a newer clean row → `clean`.
  3. An id of org B under org A's context → `untriaged` (no leak).

## Step 3 — The fact reader (mail)

- **Goal:** `replyFactsOf(db, ctx, emailIds)` in module `mail` returns per mail: headers (`email_headers` fields of `interfaces.md`, or null), `answered` (`email_flags.answered` true, or a `listUserAnswers` hit), own addresses of the org, `fromAddress`, `fromJunk` (source folder is the junk folder of `folder_map`), `folder`, `receivedAt`, `thread_key`, `to_addresses`, `cc_addresses`, `reply_to`. The `replies` module joins it with `suspicionOf` and the triage result (category, `fields.language`) into `ReplyFacts`.
- **Decisions:** a mail with no `email_flags` row and no user answer → `answered: false` (the pre-send pass in stage 09 checks again).
- **Test (integration):**
  1. A mail with `email_flags.answered = true` → `answered: true`.
  2. A mail with a user Sent row whose `parent_message_id` matches → `answered: true`; a system Sent row → false.
  3. No `email_headers` row → `headers: null`.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the job, the cap, the thread rule (stage 07).
