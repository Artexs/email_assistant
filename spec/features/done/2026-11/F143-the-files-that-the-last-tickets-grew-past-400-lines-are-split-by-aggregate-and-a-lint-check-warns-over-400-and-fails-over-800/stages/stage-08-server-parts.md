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

D5: copy the F091 scripts to `/tmp/f143-s08/`; history copies, trim right after the history merge; adapted `same-bodies.ts`. A value that both files of a step need goes to a leaf file that imports neither (D16); the old file re-exports the new one, so a new file never imports a value back from it. Edit by hand only an import line that typecheck names. D6 if `master` changes a file first.

## Test

No new test: behaviour does not change. Move proofs in `/tmp/f143-s08/<file>/`:

1. Adapted `same-bodies.ts`: `SAME_BODIES <n>`, exit 0, for each step.
2. `exports-of.ts` of each base file equals that of the new file.
3. Each new file: `git log --follow` reaches the first commit of its old file.
4. `wc -l` of each changed or new file ≤ 400.
5. `git diff --name-only <base> HEAD -- apps/server/test` prints nothing, and no importer outside the three files changed.
6. Mutation check (once): change one constant in a copy; `same-bodies.ts` exits 1 naming it. Revert. Write it in the final message.

Existing guards, unchanged: the digest, command and suggestion tests (unit and integration).

One text-reading test changes its path only: `modules/channels/consent-gate.test.ts` allows the `firstOfDay` read only in `modules/reports/digest.ts`; it names the file that holds `loadBrief` after the move. Grep tests for `reports/digest.ts`, `channels/commands.ts` and `contacts/suggest.ts` for more; name each in the final message.

## Conflicts

The time-constant ticket (F145) edits the digest and command constants; the callback-registry ticket (F149) may edit `createUpdateHandlers`. The overlap is advisory: start the stage; on a land conflict, D6.

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `plan.md` § Proof with `NN=08`.

## Out of scope

Any change of digest content, a command text, or the suggestion rules.
