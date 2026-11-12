# s2-telegram — Stage 17

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 17 — Commands: `/help`, `/status`, `/digest`

Stage 18 adds `/pause`, `/resume` and the dispatcher (`runCommand`, `createUpdateHandlers`). This stage builds the three read-only replies as separate functions, so no stage has placeholder code.

- [x] **17.1 `/help` and `/status` replies**
  - Goal: the member sees the state of the organization's mailboxes in one message (P6).
  - Files: create `apps/server/src/modules/channels/commands.ts`, `apps/server/test/integration/channels-commands.test.ts`; change `apps/server/src/modules/channels/index.ts`.
  - Interfaces:
    - `interface CommandDeps { db: Db | Transaction<DB>; now(): Date; llmDailyCap: number; triageScope: "off" | "synthetic" | "all" }`
    - `helpMessage(): OutMessage` — `{ text: helpText(), buttons: [] }`.
    - `statusMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage>`
  - Decisions:
    - Reads (only through `index.ts` files): the timezone (`getOrganization`), `listMailboxes`, `getMailboxSettings` per mailbox, `countLlmCallsSince(ctx, mailboxId, quotaDayStart(now, QUOTA_TIMEZONE))` per mailbox (S1b cap counter), `countWaiting({ receivedSince: now − 7 days })`, `getMembership(ctx, link.userId)` for the digest times.
    - Text (lines joined with `\n`; `clock(x)` = `formatClock(x, tz, now)`):
      ```
      📊 Status · <formatDay(now)> <HH:MM now>
      (per mailbox:)
      📮 <cutText(address, 60)>
      Mode: <shadow | assist | none (no settings row: not triaged)> · Status: <active | paused since <clock(status_changed_at)> | login error since <clock(status_changed_at)> (run mailbox:password)>
      Last sync: <clock(last_synced_at)> (+ " (late)" when older than 30 min) | never
      LLM calls since <clock(quota day start)>: <n> of <llmDailyCap>
      (after the mailboxes:)
      Waiting for triage: <n>
      Triage: off | test mail only (TRIAGE_LLM_SCOPE=synthetic) | real mail of the test mailbox (TRIAGE_LLM_SCOPE=all)
      Next digest: <clock of nextDigestTime> | No digest times set (bun run digest:times)
      Quiet hours: 22:00–07:00 (notices wait until 07:00)
      ```
      No mailbox → the line `No mailbox connected.` instead of the mailbox blocks. The text is cut by `cutText` per field and stays ≤ 4096 (10 mailboxes ≈ 2000 characters).
    - The quota day is the America/Los_Angeles day of the S1b cap; its start is shown in the org timezone (09:00 in Warsaw in winter).
    - `Next digest`: `nextDigestTime({ now, timeZone, times: parseDigestTimes(member.digest_times) })` → `clock(localToInstant(date, time, tz))`.
  - Test (`channels-commands.test.ts`, `withRollback`; `T` = `2026-11-06T10:00:00Z` (11:00 local); org A with one `active` mailbox, `insertDefaultSettings`, synced at `09:55Z`; 3 `llm.call` audit rows of the mailbox after `08:00Z` and 1 before; 1 `pending` mail; owner times `08:00, 16:00`; `llmDailyCap` 300; scope `all`):
    1. The text has `📮 <address>`, `Mode: shadow · Status: active`, `Last sync: 10:55`, `LLM calls since 09:00: 3 of 300`, `Waiting for triage: 1`, `Triage: real mail of the test mailbox (TRIAGE_LLM_SCOPE=all)`, `Next digest: 16:00`, `Quiet hours: 22:00–07:00`.
    2. `paused` since `2026-11-05T13:00Z` → `Status: paused since 5 Nov 14:00`; `auth_error` since `09:40Z` → `Status: login error since 10:40 (run mailbox:password)`; synced at `09:20Z` → `Last sync: 10:20 (late)`; never synced → `Last sync: never`.
    3. Times `[]` → `No digest times set (bun run digest:times)`; scope `off` → `Triage: off`; at `15:30Z` → `Next digest: 7 Nov 08:00`.
    4. Org B's `llm.call` rows and B's mailbox never show in A's text.
    5. No settings row → `Mode: none (no settings row: not triaged)`.
    6. Checkpoint 2 decision (user, 2026-11-06): the digest agrees with `/status`. `DigestMailbox.mode` in `packages/core/src/digest/digest.ts` becomes `MailboxMode | "none"`; `buildDigestMessage` (`reports/digest.ts`) maps no settings row to `none` (not `shadow`). A `none` mailbox gives no shadow line. Tests: one core test (a `none` mailbox → no shadow line) and the stage 9 integration test for a mailbox without settings.
    7. 10 mailboxes with 60-character addresses → `text.length ≤ 4096`.
    8. `helpMessage()` equals `{ text: helpText(), buttons: [] }`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: changing state (stage 18).

- [x] **17.2 `/digest` reply**
  - Goal: the member gets the digest of the current period now (P2, P6), with the same buttons; the scheduled period does not move.
  - Files: change `apps/server/src/modules/channels/commands.ts`, `apps/server/test/integration/channels-commands.test.ts`.
  - Interfaces: `digestNowMessage(deps: CommandDeps, link: LinkedChat): Promise<OutMessage>`.
  - Decisions: `periodStart = reports.digestPeriodStart(db, ctx, { userId: link.userId, linkedAt: link.linkedAt }, now)`; `reports.buildDigestMessage(db, ctx, { kind: "on_demand", periodStart, periodEnd: now, slot: null, now })`. No `digests` row and no outbox row: the reply goes out at once through the router (stage 14).
  - Test: at `T` the text starts with `📬 Digest now · Fri 6 Nov 11:00`; a result triaged in the period is a line; the count of `digests` rows is the same before and after; with a sent scheduled digest that ended at `T − 2 h`, a result at `T − 3 h` is not in the reply and one at `T − 1 h` is.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: the dispatcher (stage 18).
