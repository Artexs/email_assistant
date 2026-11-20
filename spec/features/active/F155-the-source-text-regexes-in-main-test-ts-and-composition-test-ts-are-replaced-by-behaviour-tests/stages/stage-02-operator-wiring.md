# F155 stage 02 — operator wiring

Needs F147 stage 04: `createOperatorDelivery`, `OperatorDelivery`, and the `delivery` field of `OperatorNoticeDeps` and `SloTickDeps`. May run next to 01 (both edit `apps/server/src/main.test.ts`: merge master, re-prove).
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` before the land (operator send wiring).

Replaces cases C1 and C3 of `plan.md` § Input, and the source pin that F147 stage 04 test 4 added. Decisions: P2, D1, D6–D9.

## Step 1 — the root takes its consumers (D6)

In `apps/server/src/start/operator.ts`:

```ts
export interface OperatorStartDeps {
  io: { statfs: StatFs; readFile: (path: string) => Promise<string> }; // StatFs: the type checkDisk takes
  createOperatorNotices: typeof createOperatorNotices;
  runSloTick: typeof runSloTick;
}
export function startOperator(ctx: StartContext, deps?: OperatorStartDeps): OperatorStart;
```

- The default `deps` are the real functions, `statfs` and `(path) => readFile(path, "utf8")` of `node:fs/promises`. `main.ts` keeps calling `startOperator(ctx)`.
- `startOperator` builds one delivery with `createOperatorDelivery` from the operator send (it reads `late.telegram` at send time). It passes that one delivery to `deps.createOperatorNotices` and, in the `ops.slo` function, to `deps.runSloTick`. The disk and backup check entries use `deps.io`.
- Keep the `scheduler.add(...)` and `runs.track(...)` calls and the start log line in `startOperator`, with their names, patterns and text form (`start/jobs.test.ts` reads them).

## Step 2 — the tests

New file `apps/server/src/start/operator.test.ts`. `AT` = `2026-11-20T03:00:00.000Z`. `TOKEN` = `"123456:ABCdefGhIJKlmNoPQRstuVWxyZ_-12345"` (the token of `config.test.ts`). Base env: `DATABASE_URL`, `CREDENTIALS_KEY` as in `main.test.ts`. Every env that sets `OPERATOR_TELEGRAM_CHAT_ID` also sets `TELEGRAM_BOT_TOKEN: TOKEN` (the config refuses a chat id without a token).

Set-up: `ctx = createStartContext({ config: loadConfig(env), db: {} as never, log, startedAt: AT })`. Replace `ctx.scheduler` with a fake whose `add(name, pattern, fn)` records all three. Set `ctx.late.telegram` to a fake whose `sendDirect(chat, text)` records its arguments. Spies: `createOperatorNotices` records its deps and returns `{ run: spy }` (cast); `runSloTick` records its deps. Call `startOperator(ctx, spies)`, then call both recorded functions.

1. Env with `OPERATOR_TELEGRAM_CHAT_ID: "4242"`. The recorded names and patterns equal `[["channels.operator", "0 13 * * * *"], ["ops.slo", "30 */5 * * * *"]]`. The `channels.operator` function calls the notices' `run` once. The `ops.slo` function calls `runSloTick` once. The `delivery` that `createOperatorNotices` got is (`toBe`) the `delivery` that `runSloTick` got. Breaks: give the notices a second `createOperatorDelivery(...)`; give the tick a delivery built from a send of `null`.
2. Same env. `await tickDeps.delivery.deliver({ kind: "slo_disk", status: "open", key: "alert-1" }, "text-1")` returns `true`, and the recorded `sendDirect` calls equal `[[4242, "text-1"]]`. The fake telegram is set after `startOperator` returns. Break: build the delivery from a send of `null`.
3. No chat id and no token: the same call returns `true`; the `sendDirect` calls equal `[]`.
4. `tickDeps.checks.map((c) => c.kind)` equals `["slo_sync_lag", "slo_urgent_latency", "slo_llm_errors", "slo_disk", "slo_backup_age"]`. Break: remove the disk entry.
5. Env `SLO_DISK_PATH: "/srv/disk"`, `SLO_DISK_FREE_PCT: "10"`, `SLO_DISK_FREE_GB: "1"`; fake `io.statfs` returns `{ bavail: 5, blocks: 100, bsize: 4096 }`. Running the `slo_disk` entry at `AT` calls `io.statfs` once with `"/srv/disk"`. The result has kind `slo_disk`, state firing and facts `{ free_pct: 5, free_gb: 0 }`. Break: the entry ignores `io.statfs`.
6. Env `BACKUP_STATUS_FILE: "/srv/backup.json"`, `SLO_BACKUP_MAX_AGE_H: "26"`; fake `io.readFile` returns `{"result":"ok","at":"2026-11-20T00:00:00.000Z","name":null,"bytes":null,"last_ok_at":"2026-11-20T00:00:00.000Z"}`. Running the `slo_backup_age` entry at `AT` calls `io.readFile` once with `"/srv/backup.json"`. The result has kind `slo_backup_age`, state clear and facts `{ age_h: 3, failed: 0, missing: 0 }`. Break: the entry ignores `io.readFile`.

The env values above load (the review probe checked them). A config refusal is a question in the final message, not a new value.

## Step 3 — delete the old pins

Delete C1 and C3 of `main.test.ts`. Delete the operator wiring pin that F147 stage 04 test 4 added ("one `createOperatorDelivery(` call…"), in whichever test file it lives (`main.test.ts`, `composition.test.ts`, `start/jobs.test.ts` or another). Remove imports that become unused.

## Check

- `bun test apps/server/src/start/operator.test.ts apps/server/src/main.test.ts apps/server/src/start/jobs.test.ts`.
- Each break above: the run fails, restore (D8).

## Done when

- No test reads source text to check the operator wiring: `main.test.ts` reads no source file, and no file holds the F147 test 4 pin (D9).
- The final message lists the breaks and the failing run of each.
- `bun run check:job` passes; the final message copies its last line.

## Out of scope

- The delivery itself, its log lines and texts (F147).
- The schedules and job names (P2).
