FAIL c7a94c62e5f0cb08229447915b49971019c77288

I reviewed commit `c7a94c62e5f0cb08229447915b49971019c77288`. `git rev-parse HEAD` matches it. The diff runs from merge base `dd1384e5d` to HEAD. The route code, the status mapping, the logs and the openapi entry are correct. The rewrite of `docs/capabilities/sent-mail.md` rule 13 fails: the consent rule now contradicts itself and the code.

## Blocking

**1. Rule 13 in `docs/capabilities/sent-mail.md` contradicts itself and the open-loop code. Proven by reading the code and the rule text.**

The stage Goal asks rule 13 to say three things: sent text goes to the LLM for the open-loop analysis and, on the tap, for the suggestion; the switch is the consent; the source is ADR 0029 decisions 6 and 7. The new sentences say this. But the rewritten rule also states things that are false:

- **Subject claim.** The rule says: "the model gets no subject and no address, and nothing of it is stored but the text that the owner saves." The sentence applies to both uses, and it is false for the open-loop analysis:
  - The extractor prompt sends the subject: `apps/server/src/modules/triage/prompts/extractor-v1.ts:33` writes `Subject: ${input.subject…}`, and `packages/core/src/loops/extractor.ts:125` fills it.
  - Open loops store the subject and the ask/promise texts (`open-loops.md` rule 2).
- **Old tail kept.** The rule still ends with two old sentences:
  - "The only sent-mail data that leaves it is one time in the `sent_missing` notice … no subject, address or text goes anywhere."
  - "A feature that sends sent-mail data to Telegram or an LLM must add the consent text and its version first."

  Both contradict the new sentence that sent text goes to the LLM. They also contradict ADR 0029 decision 7, which allows both LLM uses with no consent version.
- **Fix.** Make the "no subject, no address, nothing stored" clause apply only to the style suggestion. For the open-loop analysis, say that the subject and the recipient count go with the text. Limit the `sent_missing` sentence to Telegram. Change the last sentence so that only a new LLM or Telegram use outside ADR 0029 decision 7 needs a consent text and version.
- **Check that proves it wrong:** `grep -n "Subject:" apps/server/src/modules/triage/prompts/extractor-v1.ts`, then read the end of rule 13.

## Unverified

- **No checks run.** I ran no test, lint or typecheck. The task says "run no suite", and the worktree has no `node_modules`.
- **Openapi drift test not run.** `apps/server/src/platform/openapi.test.ts` and `apps/server/src/openapi-routes.test.ts` rest on the worker's `check:job` line and on CI. I compared the openapi entry with the route by hand only.

## Notes (each checked against the code, not run)

- **Guard order: correct.** Labelled proven by code read. `routes.ts:111-147` runs `flagsFirst("reply_drafts","style_from_sent")`, then `requireOwner`, then the UUID check, then `parseBody(styleSuggestionBodySchema)` (a `z.strictObject({})`), then the service. The service answers `not_found` for another organization's mailbox. The test file `replies-style-suggest-route.test.ts` covers:
  - 401 with no session.
  - 403 for a member, also for an unknown id.
  - 404 for each flag off, for owner, member, bad id and bad body.
  - 400 for `{x:1}`.
  - 404 for another organization's mailbox, with the real service and no model call.
- **Status mapping: complete and correct.** Labelled proven by code read. The switch handles all 8 kinds of `StyleSuggestResult` and matches `interfaces.md` § Route: 200 suggestion and failed, 409 `sent_off`, `too_few`+count and `blocked`+reason, 429 `suggest_limit` and `suggest_busy`, 404 `not_found`. A `test.each` table covers each kind once and parses each 200/409 body with its core schema.
- **No text in logs or audit: correct.** Labelled proven by code read. The route adds no log or audit call. The test checks that the `style_suggested` line has exactly `{org_id, mailbox_id, count}`. It also checks that the audit row is `{mailbox_id, count, outcome, via}`. The stage text says "mailbox_id and count only", but `org_id` comes from the request context, so this is fine.
- **Openapi entry matches the route.** Labelled proven by reading `docs/api/openapi.json`. It has POST at `/api/mailboxes/{id}/profile/style-suggestion` with `operationId` `suggestMailboxStyle` and a uuid path param. The body is an empty object with `additionalProperties:false`. The responses are a 200 union with the reason enum, 400/401/403/404, a 409 union of three strict objects, 413 and 429 with both codes. This matches `api-docs.ts` `suggestStyle`.
- **No model client skips the mailbox check.** Labelled proven by code read, not a defect. With no model client, the route answers `200 failed llm_off` before any mailbox lookup. An unknown or foreign mailbox then gets 200, not 404. This shows nothing about whether the mailbox exists, and the preview route does the same. Rule 18 lists "the mailbox" as the last guard, so a short line there would help.
- **Bad id plus bad body.** Labelled proven by code read. A non-UUID id with a bad body answers 404, not 400, because the UUID check runs before `parseBody`. Rule 18 lists "the body; the mailbox", so the docs and the code differ in this corner. This is minor.
- **Rest of the diff: no problems.** Labelled proven by code read.
  - `web-suspended.test.ts` lists the new write route.
  - `start/http.ts` and `web-routers.ts` wire `styleSuggestion` from `start/triage.ts`, which builds it with `createStyleSuggestion`.
  - `getOrgOwner` turns an unknown locale into `null`, so the `language` type holds.

## Checks run

- `git rev-parse HEAD`: `c7a94c62e5f0cb08229447915b49971019c77288`, which matches the candidate.
- `git diff dd1384e5d HEAD`: read in full for `apps/server/src`, `packages`, `docs/capabilities` and the test files. The openapi part was read by section.
- `grep`/`sed` reads of `extractor-v1.ts`, `packages/core/src/loops/extractor.ts`, ADR 0029, `docs/capabilities/open-loops.md`, `interfaces.md`, `plan.md` D8 and D11, and the stage file.
- No test, lint, typecheck or `check:job` run.

## Note check

- **Guard order** (session 401, flags 404 for every role, owner 403, strict body 400, other-org 404): proven. Evidence: `apps/server/src/modules/replies/routes.ts` and `apps/server/test/integration/replies-style-suggest-route.test.ts`, read in this session. The test was not run.
- **Status mapping and no text in logs or audit:** proven. Evidence: `apps/server/src/modules/replies/routes.ts` checked against `spec/features/active/F122-e6b-style-from-sent/interfaces.md`. The route adds no log or audit call.
- **Openapi match and docs consent text:**
  - Openapi match: proven. Evidence: `docs/api/openapi.json` checked against `apps/server/src/modules/replies/api-docs.ts`.
  - Docs consent text: broken. `docs/capabilities/sent-mail.md` rule 13 conflicts with `apps/server/src/modules/triage/prompts/extractor-v1.ts` and with its own last sentences (blocking finding 1).
- **Easy-to-miss rule "Run no suite":** followed. I ran no suite, lint, typecheck or test file. The worktree has no `node_modules`.
- **Reminder: tests run once per job; never `--no-verify`:** followed. I made no commit and ran no test.
- **Reminder: `check:job` for product-code jobs:** does not apply. This is a review job with no commit.
- **Reminder: a review job runs no suite, lint or typecheck:** followed. None ran.
- **Reminder: never delete `node_modules/.cache/`:** followed. I deleted nothing.
