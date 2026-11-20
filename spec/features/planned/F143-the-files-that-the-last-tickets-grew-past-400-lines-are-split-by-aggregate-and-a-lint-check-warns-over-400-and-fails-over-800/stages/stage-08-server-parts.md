# F143 stage 08 — digest, commands and rule suggestions

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md).

## Goal

Three server files over 400 lines split by aggregate as top-level moves (D5, D7): `modules/reports/digest.ts` (457), `modules/channels/commands.ts` (443), `modules/contacts/suggest.ts` (443).

## Step 1 — digest

- `reports/digest-brief.ts`: the loads that feed the digest: `loadBrief`, `loadSpamReview`, `panelLinks`, `spamReviewUrlOf` and the constants only they use.
- `reports/digest.ts` keeps the period, the request and result types and `buildDigest`, `buildDigestMessage`, and re-exports by name what moved.

## Step 2 — Telegram commands

- `channels/commands-status.ts`: `statusMessage` and its private helpers (`approvedText`, `approvalLines`, `statusText`).
- `channels/commands-switch.ts`: `switchMailboxes`, its text helpers, `pauseMailboxes`, `resumeMailboxes`.
- `channels/commands.ts` keeps `CommandDeps`, `telegramDetailOf`, `helpMessage`, `digestNowMessage`, `reviewMessage`, `runCommand`, `createUpdateHandlers` and re-exports by name what moved. `CommandDeps` stays here; the new files `import type` it (a type-only cycle is allowed; a value cycle is not).

## Step 3 — rule suggestions

- `contacts/suggest-input.ts`: the pure pattern and input code: `rulePatternOf`, `suggestionPatternEligible`, `hostOf`, `ruleAndDelegateMembers`, `bareInput`, `inputOf`.
- `contacts/suggest.ts` keeps the pass (`refreshSuggestions`, insert, standing, block, withdraw, open rows, end) and re-exports by name what moved.
- Do not touch `contacts/activity.ts` (the sender-activity ticket, F144, owns it).

## Method (each step)

D5: copy the F091 scripts to `/tmp/f143-s08/`; history copies, trim right after the history merge; adapted `same-bodies.ts`. A helper that both files of a step need stays in the file of its topic with an internal export. Edit by hand only an import line that typecheck names. D6 if `master` changes a file first.

## Test

No new test: behaviour does not change. Move proofs in `/tmp/f143-s08/<file>/`:

1. Adapted `same-bodies.ts`: `SAME_BODIES <n>`, exit 0, for each step.
2. `exports-of.ts` of each base file equals that of the new file.
3. Each new file: `git log --follow` reaches the first commit of its old file.
4. `wc -l` of each changed or new file ≤ 400.
5. `git diff --name-only <base> HEAD -- apps/server/test` prints nothing, and no importer outside the three files changed.
6. Mutation check (once): change one constant in a copy; `same-bodies.ts` exits 1 naming it. Revert. Write it in the final message.

Existing guards, unchanged: the digest, command and suggestion tests (unit and integration).

## Conflicts

The time-constant ticket (F145) edits the digest and command constants; the callback-registry ticket (F149) may edit `createUpdateHandlers`. Either lands first; the other merges `master` (D6 for this stage).

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `mkdir -p /tmp/f143-s08 && bun run lint > /tmp/f143-s08/lint.log 2>&1 && bun run typecheck > /tmp/f143-s08/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s08/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s08/int.log 2>&1 && echo PROOF_OK`

## Out of scope

Any change of digest content, a command text, or the suggestion rules.
