# Cut stage 10: lab bot cases 7–11 to unit

Base: `173de1d3`. Scan: `scan-cli.ts` at the base, then `cut-keys.ts --group G01 --area apps/server/test/integration/lab-bots.test.ts` (11 keys: 5 `ok`, 6 `deferred-none`). The six `deferred-none` keys are the cases the previous stage moved; they are not deferrals.

## Resolved keys

| old key (int file) | status | new place |
|---|---|---|
| `lab-bots.test.ts:634` a crash between the fifth error and its skip: the next tick writes the skip and tries nothing | ok | `apps/server/src/modules/lab/bots.test.ts` (inside `describe("failed sends")`) |
| `lab-bots.test.ts:651` four errors, then a restart and a good send: the reply goes out once | ok | same |
| `lab-bots.test.ts:664` a subject that decodes to a line break ends as render_failed after five tries; nothing goes out | ok | same |
| `lab-bots.test.ts:686` a long subject is cut to 200 characters in the reply | ok | same |
| `lab-bots.test.ts:738` a failed read of one delegate inbox does not stop the others | ok | same |

Deferred rows: none. Rejected rows: none. Open branches: no unmerged `limen/*` branch changes `lab-bots.test.ts`, `lab/bots.ts` or `lab/mail-client.ts` (checked with `git diff --name-only <merge-base>...<branch>`).

## Changes

- Each case keeps its name and every assert. The delegate mail goes in through `deliver` of the fake.
- "A crash between the fifth error and its skip": the int case counted calls of a failing SMTP wrapper; the unit case reads `mail.calls.smtpSend` (0). The `failingSmtp` helper left the int file with it.
- "A subject that decodes to a line break": `sendToDelegate` of the unit file gets the `rawSubject` option; the int file lost it (no case uses it).
- "A failed read of one inbox": the fake's `failNext` fails the next call whatever the mailbox, so the case keeps the two wrappers of the int case (one fails the second delegate, one the first) around the fake. No new fake hook.
- Int file: the `describe("failed sends")` block and the two cases are removed with the `simpleParser` and `MAX_ERRORS_PER_REPLY` imports. It keeps the real-IMAP cases.

## Break once

In `lab/bots.ts`, `SUBJECT_LIMIT` 200 → 199: `bun test apps/server/src/modules/lab/bots.test.ts` → 1 fail (`a long subject is cut to 200 characters in the reply`), 10 pass. `bots.ts` restored (`git checkout`; no diff).

## cut-proof, stage 10

Before: `/tmp/f125-s10/before-1`, `/tmp/f125-s10/before-2`. After: `/tmp/f125-s10/after`. Expected: unit=+5, int=-5.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 6 | 11 | 0.58 s | 0.56 s |
| int | 17 | 12 | 55.62 s | 34.23 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Int time of `lab-bots.test.ts`: 83.90 s before stage 09 (`cut-s09.md`), 56.32 s after it, 34.23 s after this stage (serial runs of cut-run).

Result: PASS
