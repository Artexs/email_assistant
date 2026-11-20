# F136 stage 02 — Mail tag for GreenMail addresses

Needs: nothing new; it reads `apps/server/src/scripts/e2e-seed-args.ts`, `e2e-seed.ts` and `apps/web/e2e/helpers.ts` at HEAD. May run next to 01 and 03 (no shared file).

Part of [`../plan.md`](../plan.md). Decisions D6, D8.

## Step 1 — The tag function

**Goal.** Two runs at once never log in to the same GreenMail account.

**Files.** `apps/server/src/scripts/e2e-seed-args.ts` (the addresses live here) and a new unit test file next to it. Do not edit the existing `e2e-seed-args.test.ts`.

**Interfaces.**
- `mailTagFromEnv(env: Record<string, string | undefined>): string`. Reads `E2E_MAIL_TAG`. Unset or `""` → `""`. Otherwise it must match `^[a-z0-9]{1,16}$`, or it throws a message that holds `E2E_MAIL_TAG`.
- `taggedAddress(address: string, tag: string): string`. An empty tag → the address unchanged. Otherwise it inserts `-<tag>` before the last `@`.
- Every function that returns a GreenMail-backed address (`e2eApprovalsMailbox`, `e2eDelegatesMailbox`, … every address that reaches `seedAssistMailbox`, also any address that `e2e-seed.ts` builds inline before it calls `seedAssistMailbox`) returns `taggedAddress(base, mailTagFromEnv(process.env))`. The worker lists them by reading every `seedAssistMailbox(` call. Prefer one registry, a typed list of the GreenMail-backed bases, that the test can walk, over a call in each function. If a typed list does not fit the per-project functions, a test that calls each function is enough.
- Guard (review N6): when the tag is set, `seedAssistMailbox` throws on an address that does not end in `-<tag>@<domain>`, so a later seed edit cannot add an untagged GreenMail address.
- `e2e-paused-box@x.test` stays untagged: the seed inserts it directly (not through `seedAssistMailbox`), the mailbox is paused and never synced, and `plan.spec.ts` asserts the literal text (review N5).
- Addresses that never reach GreenMail stay unchanged: `e2eDeleteMailbox`, the user login addresses and `E2E_SEND_TEST_ADDRESS` (`anna@example.com`, the send sink that no spec reads; `SEND_TEST_ADDRESSES` must keep matching it).

**Test (new file).**
1. `taggedAddress("e2e-mobile@e2e.test", "")` → `"e2e-mobile@e2e.test"`.
2. `taggedAddress("e2e-mobile@e2e.test", "1ac5ae68")` → `"e2e-mobile-1ac5ae68@e2e.test"`.
3. `mailTagFromEnv({})` → `""`, and `mailTagFromEnv({ E2E_MAIL_TAG: "1ac5ae68" })` → `"1ac5ae68"`.
4. `"Bad_Tag"`, `"a@b"` and a 17-character tag each throw a message that holds `E2E_MAIL_TAG`.
5. With `process.env.E2E_MAIL_TAG = "t1"`, every GreenMail-backed address function returns an address that ends in `-t1@e2e.test`, and `e2eDeleteMailbox("mobile")` still returns `del-phone@x.test`. Restore the key in `finally`.
6a. With `E2E_MAIL_TAG=t1`, `seedAssistMailbox` (or its pure address check) refuses `e2e-x-mobile@e2e.test` with a message that holds `E2E_MAIL_TAG`.
6. With the key unset, `e2eApprovalsMailbox("mobile")` → `"e2e-approvals-mobile@e2e.test"` (today's value: main checkout and CI do not change).

## Step 2 — The panel helper uses the tag

**Goal.** `connectGreenMail` and the specs that look up the connected mailbox use the run address.

**Decisions.**
- `mailboxAddress(project)` in `apps/web/e2e/helpers.ts` returns `taggedAddress(`e2e-${project}@e2e.test`, mailTagFromEnv(process.env))`. `helpers.ts` is not a spec file. No `*.spec.ts` changes (fact F4: specs hold no literal GreenMail address).
- The seed runs in a child process with `e2eEnv()`, which spreads `process.env`. The spec workers load `.env` through `env.ts`. Both therefore see the same tag. Stage 01's `.env` loading must be in place for a tag that lives only in `.env`. Before stage 01 lands, set the tag in the process env for the manual run below.
- The tag is not shown in the docs shots: the shot run signs in as the main organization, and that organization has no seeded GreenMail mailbox. The public-content check of the shot run still applies.

**Test.**
7. Manual, under the lock: `E2E_MAIL_TAG=s02probe bun run test:e2e` passes on the stage's own e2e DB. The log, or a DB read of the e2e DB, shows mailbox addresses that end in `-s02probe@e2e.test`.
8. Manual, under the lock: `bun run test:e2e` with no tag passes (today's addresses).

**Out of scope.** Ports (stage 01), prepare (stage 04), GreenMail of CI (no tag there).

## Done when

Tests 1–8 pass. Proof links after `test:int:ci`: `bun run web:build > /tmp/f136-s02/web.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock env E2E_MAIL_TAG=s02probe bun run test:e2e > /tmp/f136-s02/e2e-tag.log 2>&1 && flock /tmp/email-assistant-shared-tests.lock bun run test:e2e > /tmp/f136-s02/e2e.log 2>&1`.
