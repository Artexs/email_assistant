# F100 stage 07 — Sync every 2 min and the LLM pause line (F073)

Part of [`../plan.md`](../plan.md). Needs stage 02 on `master`. Not next to stage 06 (both touch the mail job area and `main.ts`). After the land: tell the owner about owner step O1; coordinator steps C3 and C4 follow stage 07.

After this stage the mail sync runs every 2 minutes by default (`MAIL_SYNC_EVERY_MIN` = 2, 3 or 5), and `/status` and the digest say when the LLM is paused and why, with the quota case in plain words.

## Step 1 — Sync interval

**Goal.** The interval is a config key with default 2 (D7).

**Files.** `apps/server/src/platform/config.ts` (+ `config.test.ts`), `.env.example`, `apps/server/src/main.ts`, `apps/server/src/modules/channels/commands.ts` (`changeLines` resume text; `CommandDeps` gains `syncEveryMin: number`), the place that builds `CommandDeps` (`createTelegramRuntime` deps in `channels/index.ts` or `telegram/…`; follow `operatorContact`), `apps/server/test/integration/channels-commands.test.ts`, `deploy/compose.yaml` only if it lists env keys one by one (do not set the key there: the default applies).

**Interfaces.**

```ts
// config.ts
MAIL_SYNC_EVERY_MIN: z.preprocess(emptyAsUndefined, z.enum(["2", "3", "5"]).default("2")),
export function mailSyncCron(config: Config): string; // `*/${n} * * * *`

// main.ts
scheduler.add("mail.sync", mailSyncCron(config), mailSync.run);
log.info("mail_sync_interval", { minutes: Number(config.MAIL_SYNC_EVERY_MIN) });
```

`.env.example`, next to the other mail keys:

```
# Minutes between two mail syncs: 2 (default), 3 or 5. Use 3 when the mail host throttles logins.
MAIL_SYNC_EVERY_MIN=
```

Resume text: `` `The next sync runs within ${deps.syncEveryMin} minutes. Mail that came during the pause is read then; mail older than 7 days is not triaged.` `` (`changeLines` gets the number as a parameter).

Add `minutes` to `platform/log-fields.ts` if it is not there.

**Decisions.** D7, D30.

**Test.**

1. Unit (`config.test.ts`): no key → `"2"` and `mailSyncCron` → `*/2 * * * *`; `"3"` → `*/3 * * * *`; `"4"` → a config error naming `MAIL_SYNC_EVERY_MIN`.
2. Integration (`channels-commands.test.ts`): `/resume` with `syncEveryMin: 3` → the text holds "within 3 minutes".

**Check.** `bun test apps/server/src/platform/config.test.ts apps/server/test/integration/channels-commands.test.ts`

**Done when.** Cases 1–2 pass; `grep -rn '"\*/5 \* \* \* \*", mailSync' apps/server/src/main.ts` prints nothing.

**Out of scope.** IMAP IDLE (E8); the heartbeat interval (stays 5 min).

## Step 2 — LLM pause cause in `/status` and the digest

**Goal.** A pause and its code are visible to the user from the `llm.call` rows, behind the flag `llm_pause_line` (D8, D26, F073).

**Files.** `packages/core/src/features.ts` (+ test: flag `llm_pause_line`, epic `E3a`, remove-by `2027-03-01`, default off, description "/status and the digest name an LLM pause and its cause."), `apps/server/src/platform/llm/errors.ts` (export the code lists), `apps/server/src/platform/llm/index.ts`, `apps/server/src/modules/audit/repo.ts` or a new `audit/llm-pause.ts` (+ `audit/index.ts`), `packages/core/src/digest/notices.ts` or a new `packages/core/src/digest/llm-pause.ts` (+ index), `packages/core/src/digest/digest.ts` (`DigestInput.llmPause`), `apps/server/src/modules/reports/digest.ts`, `apps/server/src/modules/channels/commands.ts` (`statusMessage`), `apps/server/test/integration/audit-llm-pause.test.ts` (new), unit tests next to the core files.

**Interfaces.**

```ts
// platform/llm/errors.ts — the runtime lists of the existing code types.
export const softCodes = ["http_429", "http_500", "http_502", "http_503", "http_504", "http_5xx", "timeout", "network"] as const satisfies readonly SoftCode[];
export const configCodes = [
  "http_401", "http_402", "http_403", "http_404", "http_400_key", "http_400_precondition",
  "http_429_quota", "http_400_schema", "schema_not_strict", "missing_key",
] as const satisfies readonly ConfigCode[];
// A test checks that each list holds every member of its type (an exhaustive Record<SoftCode, true> in the test).

// audit — the newest llm.call row of the organization. A pause when its reason_code is a soft code and the row is at most
// 10 min old (a soft pause starts at 5 min, triage/pause.ts), or a config code and the row is at most 2 h old (a config
// pause doubles up to 60 min and a quota stays spent). Then `{ code, since }`, where `since` is the oldest row of the
// unbroken run of pause-code rows before it (no `ok` between). Else null.
export async function latestLlmPause(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { now: Date; softCodes: readonly string[]; configCodes: readonly string[] }
): Promise<{ code: string; since: Date } | null>;

// core
export interface LlmPause { code: string; since: Date }
export function llmPauseLine(pause: LlmPause, timeZone: string, now: Date): string;
// http_429_quota → `⏸ LLM paused since ${clock}: the provider quota or budget is spent (http_429_quota). Triage waits.`
// other          → `⏸ LLM paused since ${clock} (${code}). Triage waits.`
// clock = formatClock(since, timeZone, now)
```

- `latestLlmPause` reads at most 200 newest rows of the last 2 h (`ORDER BY created_at DESC, id DESC LIMIT 200`, `event = 'llm.call'`, `org_id` filter); in code: the age rule above on the newest row; then walk back while the rows are pause codes.
- `statusMessage`: when `isFeatureOn(db, ctx, "llm_pause_line")` and `latestLlmPause(...)` is not null, add `llmPauseLine(...)` after the `LLM: <provider> · <model>` line. `CommandDeps` needs no new field for it.
- `buildDigestMessage` passes `llmPause` (same flag, same call); `renderDigest` adds `llmPauseLine` as the first footer line when set.

**Decisions.** D8.

**Test.**

1. Unit (core): `llmPauseLine({ code: "http_429_quota", since: 2026-11-20T09:05:00Z }, "Europe/Warsaw", now = 2026-11-20T10:00:00Z)` → `⏸ LLM paused since 10:05: the provider quota or budget is spent (http_429_quota). Triage waits.` (the clock text as `formatClock` prints it for the same day); `{ code: "timeout", … }` → the generic line.
2. Unit (core): `renderDigest` with `llmPause` set → the footer's first line is that line; without it the digest text is unchanged (existing cases green).
3. Integration (audit, `now` = 09:15): rows `ok` at 09:00, `http_429_quota` at 09:05 and 09:10 → `{ code: "http_429_quota", since: 09:05 }`; add an `ok` row at 09:12 → null; the same quota rows with `now` = 11:20 → null (older than 2 h); one `timeout` row at 09:00 with `now` = 09:05 → `{ code: "timeout", … }`, with `now` = 09:20 → null; org B sees null for org A's rows.
4. Integration (`channels-commands.test.ts`): `/status` with the quota rows of case 3 and the flag on → the text holds `quota or budget is spent`; flag off → no pause line.
5. Unit: the code lists hold every member of `SoftCode` and `ConfigCode`.

**Check.** `bun test packages/core/src/digest/ apps/server/src/platform/llm/ apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/audit-llm-pause.test.ts`

**Done when.** Cases 1–5 pass.

**Out of scope.** A notice push on a pause (the digest and `/status` are enough, F073); a second provider (F072, out of Stage 2).

## Step 3 — Docs for the owner step and the alert

**Goal.** The owner can set the budget alert from written steps; the alert entry points to the new line.

**Files.** `deploy/README.md` (new section "LLM provider budget"), `docs/known-alerts.md` (the entry whose source is `triage/pause.ts`).

- `deploy/README.md` § "LLM provider budget": why (a spent budget stops triage with `http_429_quota`); the steps in the OpenAI platform: open the project that owns `OPENAI_API_KEY`, set a monthly budget (the pilot used $3, `spec/features/done/2026-11/F026-llm-provider-switch/plan.md` stage 0) and an e-mail alert below it (for example at 80 %); check the `/status` line after a quota pause. Mark the menu names as "not verified (2026-11)"; the owner does the steps (O1).
- `docs/known-alerts.md`: in the `http_429_quota` fix text add "`/status` and the digest show `⏸ LLM paused … (http_429_quota)` (F100 stage 07)".

**Decisions.** D8, P8.

**Test.** None (docs). `bun test apps/server/src/capability-map.test.ts` still passes.

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** Both sections exist.

**Out of scope.** Doing the owner step.

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f100-s07`).
