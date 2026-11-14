# F100 stage 07 — Sync every 2 min and the LLM pause line (F073)

Part of [`../plan.md`](../plan.md). Needs stage 02 on `master`. Not next to stage 06 (both touch the mail job area and `main.ts`). After the land: tell the owner about owner step O1; coordinator steps C3 and C4 follow stage 07.

After this stage the mail sync runs every 2 minutes by default (`MAIL_SYNC_EVERY_MIN` = 2, 3 or 5), and `/status` and the digest say when the LLM is paused and why, with the quota case in plain words.

## Step 1 — Sync interval

**Goal.** The interval is a config key with default 2 (D7).

**Files.** `apps/server/src/platform/config.ts` (+ `config.test.ts`), `.env.example`, `apps/server/src/main.ts`, `apps/server/src/modules/channels/commands.ts` (`changeLines` resume text; `CommandDeps` gains `syncEveryMin: number`), the place that builds `CommandDeps` (`createTelegramRuntime` deps in `channels/index.ts` or `telegram/…`; follow `operatorContact`), `apps/server/test/integration/channels-commands.test.ts`, `deploy/compose.yaml` only if it lists env keys one by one (do not set the key there: the default applies), `docs/capabilities/sync.md` (line 7 "Every 5 minutes", rule 6 cron, the `mail.sync` job row of Entry points, rule 16 "mail of the last 5 minutes" and the Limits line "E3a (F100) moves the poll to 2 minutes": the interval is `MAIL_SYNC_EVERY_MIN` minutes, default 2, also 3 or 5; the Limits line keeps only "no IMAP IDLE (E8)"), `docs/architecture.md` §4.1 (the flow line `Scheduler: every 5 min per mailbox` → `every MAIL_SYNC_EVERY_MIN min (default 2)`), `docs/capabilities/digest-and-notices.md` rule 9 (the `/resume` text, if the page quotes it).

**Interfaces.**

```ts
// config.ts
MAIL_SYNC_EVERY_MIN: z.preprocess(emptyAsUndefined, z.enum(["2", "3", "5"]).default("2")),
export function mailSyncCron(config: Config): string; // `*/${n} * * * *`

// main.ts
scheduler.add("mail.sync", mailSyncCron(config), mailSync.run);
log.info("mail_sync_interval", { minutes: Number(config.MAIL_SYNC_EVERY_MIN) });
```

`.env.example`, next to the other mail keys (the F099 `SEND_LIMIT_*` keys are their own block; do not put the key inside it):

```
# Minutes between two mail syncs: 2 (default), 3 or 5. Use 3 when the mail host throttles logins.
MAIL_SYNC_EVERY_MIN=
```

Resume text: `` `The next sync runs within ${deps.syncEveryMin} minutes. Mail that came during the pause is read then; mail older than 7 days is not triaged.` `` (`changeLines` gets the number as a parameter).

Add `minutes` to `platform/log-fields.ts` if it is not there (after F103 stage 01: to its number kind list, plan D30). `platform/config.ts` is 493 lines (plan F13): add only the key and `mailSyncCron`, next to `sendLimits`. The resume text follows plan D31 when `packages/core/src/texts/index.ts` exists (after F098 stage 11 the command texts live in `texts.bot`).

**Decisions.** D7, D30.

**Test.**

1. Unit (`config.test.ts`): no key → `"2"` and `mailSyncCron` → `*/2 * * * *`; `"3"` → `*/3 * * * *`; `"4"` → a config error naming `MAIL_SYNC_EVERY_MIN`.
2. Integration (`channels-commands.test.ts`): `/resume` with `syncEveryMin: 3` → the text holds "within 3 minutes".

**Check.** `bun test apps/server/src/platform/config.test.ts apps/server/test/integration/channels-commands.test.ts apps/server/src/capability-map.test.ts`

**Done when.** Cases 1–2 pass; `grep -n "5 min" docs/capabilities/sync.md` shows no line about the sync interval; `grep -rn '"\*/5 \* \* \* \*", mailSync' apps/server/src/main.ts` prints nothing.

**Out of scope.** IMAP IDLE (E8); the heartbeat interval (stays 5 min).

## Step 2 — LLM pause cause in `/status` and the digest

**Goal.** A pause and its code are visible to the user from the `llm.call` rows, behind the flag `llm_pause_line` (D8, D26, F073).

**Files.** `packages/core/src/features.ts` (+ test: flag `llm_pause_line`, epic `E3a`, remove-by `2027-03-01`, default off, description "/status and the digest name an LLM pause and its cause.") and the three tests that list every flag (plan § Rules for every stage), `apps/server/src/platform/llm/errors.ts` (export the code lists), `apps/server/src/platform/llm/index.ts`, a new `apps/server/src/modules/audit/llm-pause.ts` (+ `audit/index.ts`; `audit/repo.ts` is 320 lines; it may read the rows with `listAuditEvents(db, ctx, { events: ["llm.call"], since: now − 2 h, limit: 200 })` of F099, plan F18), a new `packages/core/src/digest/llm-pause.ts` (+ index; `digest/notices.ts` gained the F099 send-limit texts), `packages/core/src/digest/digest.ts` (`DigestInput.llmPause`), `apps/server/src/modules/reports/digest.ts`, `apps/server/src/modules/channels/commands.ts` (`statusMessage`), `apps/server/test/integration/audit-llm-pause.test.ts` (new), unit tests next to the core files, `docs/capabilities/digest-and-notices.md` (rule 4: the footer's first line can be the LLM pause line behind `llm_pause_line`; rule 9 `/status`: the pause line after the LLM provider and model; refresh the "Checked against" line), `docs/capabilities/triage.md` (the Limits line "The LLM pause is in memory: a restart clears it" gains: "`/status` and the digest read the pause from the `llm.call` audit rows (`latestLlmPause`), so they show it after a restart too"). The texts follow plan D31.

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

**Check.** `bun test packages/core/src/digest/ packages/core/src/features.test.ts apps/server/src/platform/llm/ apps/server/test/integration/channels-commands.test.ts apps/server/test/integration/audit-llm-pause.test.ts apps/server/test/integration/tenancy-features.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/org-flag-cli.test.ts apps/server/src/capability-map.test.ts`

**Done when.** Cases 1–5 pass.

**Out of scope.** A notice push on a pause (the digest and `/status` are enough, F073); a second provider (F072, out of Stage 2).

## Step 3 — Docs for the owner step and the alert

**Goal.** The owner can set the budget alert from written steps; the alert entry points to the new line.

**Files.** `deploy/README.md` (new section "LLM provider budget"), `docs/known-alerts.md` (of the three entries whose source is `triage/pause.ts`, the one whose codes list `http_429_quota`, about line 721 at `a6690e4`).

- `deploy/README.md` § "LLM provider budget": why (a spent budget stops triage with `http_429_quota`); the steps in the OpenAI platform: open the project that owns `OPENAI_API_KEY`, set a monthly budget (the pilot used $3, `spec/features/done/2026-11/F026-llm-provider-switch/plan.md` stage 0) and an e-mail alert below it (for example at 80 %); check the `/status` line after a quota pause. Mark the menu names as "not verified (2026-11)"; the owner does the steps (O1).
- `docs/known-alerts.md`: in that entry's `http_429_quota` fix text add "`/status` and the digest show `⏸ LLM paused … (http_429_quota)` (F100 stage 07)".

**Decisions.** D8, P8.

**Test.** None (docs). `bun test apps/server/src/capability-map.test.ts` still passes.

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** Both sections exist.

**Out of scope.** Doing the owner step.

## Done when (stage)

Steps 1–3 done; the Proof command of `plan.md` passes (`/tmp/f100-s07`).
