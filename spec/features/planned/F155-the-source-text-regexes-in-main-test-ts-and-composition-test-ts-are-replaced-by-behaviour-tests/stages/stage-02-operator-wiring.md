# F155 stage 02 — operator wiring

Needs F147 stage 04: `createOperatorDelivery`, `OperatorDelivery`, and the `delivery` field of `OperatorNoticeDeps` and `SloTickDeps`. May run next to 01 (both edit `apps/server/src/main.test.ts`: merge master, re-prove).
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` before the land (operator send wiring).

Replaces cases C1 and C3 of `plan.md` § Input, and the source pin that F147 stage 04 left for C1. Decisions: P2, D1, D6–D9.

## Step 1 — the builder (D6)

In `apps/server/src/start/operator.ts`:

```ts
export interface OperatorIo {
  statfs: StatFs;                              // the type that checkDisk takes
  readFile: (path: string) => Promise<string>;
}
export interface OperatorWiring {
  delivery: OperatorDelivery;
  notices: OperatorNoticeDeps;
  sloTick: SloTickDeps;
}
export function operatorWiring(ctx: StartContext, io?: OperatorIo): OperatorWiring;
```

- `io` defaults to `statfs` and `(path) => readFile(path, "utf8")` of `node:fs/promises`.
- It builds the operator send (reads `late.telegram` at send time), the one delivery, the five SLO check entries, and both deps from that one delivery. It schedules nothing and logs nothing.
- `startOperator` calls `operatorWiring(ctx)`, passes `notices` to `createOperatorNotices` and `sloTick` to `runSloTick`. The `scheduler.add("channels.operator", …)`, `scheduler.add("ops.slo", …)` and `runs.track(…)` calls and the start log line stay in `startOperator` as they are (`start/jobs.test.ts` reads their text).
- Export the types through a module's `index.ts` only if they are not public yet.

## Step 2 — the tests

New file `apps/server/src/start/operator.test.ts`. Build the context with `createStartContext({ config: loadConfig({ ...env }), db: {} as never, log, startedAt: AT })`, then set `ctx.late.telegram` to a fake whose `sendDirect(chat, text)` records its arguments. `AT` = `2026-11-20T03:00:00.000Z`. Base env: `DATABASE_URL`, `CREDENTIALS_KEY` as in `main.test.ts`.

1. With `OPERATOR_TELEGRAM_CHAT_ID: "4242"`: `w.notices.delivery` is (`toBe`) `w.sloTick.delivery`, and is `w.delivery`. Break: give the notices their own delivery.
2. Same env; set `late.telegram` after `operatorWiring` returns. `await w.sloTick.delivery.deliver({ kind: "slo_disk", status: "open", key: "f155-1" }, "T1")` returns `true`; the recorded calls equal `[[4242, "T1"]]`. Break: build the deps with a send of `null`.
3. No `OPERATOR_TELEGRAM_CHAT_ID`: the same call returns `true`; the recorded calls equal `[]`.
4. `w.sloTick.checks.map((c) => c.kind)` equals `["slo_sync_lag", "slo_urgent_latency", "slo_llm_errors", "slo_disk", "slo_backup_age"]`. Break: remove the disk entry.
5. Env `SLO_DISK_PATH: "/f155/disk"`, `SLO_DISK_FREE_PCT: "10"`, `SLO_DISK_FREE_GB: "1"`; fake `statfs` returns `{ bavail: 5, blocks: 100, bsize: 4096 }`. Running the `slo_disk` entry at `AT` calls `statfs` once with `"/f155/disk"` and gives kind `slo_disk`, state firing, facts `{ free_pct: 5, free_gb: 0 }`. Break: the entry ignores `io.statfs`.
6. Env `BACKUP_STATUS_FILE: "/f155/backup.json"`, `SLO_BACKUP_MAX_AGE_H: "26"`; fake `readFile` returns `{"result":"ok","at":"2026-11-20T00:00:00.000Z","name":null,"bytes":null,"last_ok_at":"2026-11-20T00:00:00.000Z"}`. Running the `slo_backup_age` entry at `AT` calls `readFile` once with `"/f155/backup.json"` and gives kind `slo_backup_age`, state clear, facts `{ age_h: 3, failed: 0, missing: 0 }`. Break: remove the backup entry.

If a config value above is refused by the config schema, use the nearest value it takes and keep the expected result; say so in the final message.

Delete C1, C3 and any operator source pin left in `main.test.ts` by F147 stage 04. Remove imports that become unused.

## Check

- `bun test apps/server/src/start/operator.test.ts apps/server/src/main.test.ts apps/server/src/start/jobs.test.ts`.
- Each break above: the run fails, restore (D8).

## Done when

- `main.test.ts` reads no source file (D9).
- The final message lists the breaks and the failing run of each.
- `bun run check:job` passes; the final message copies its last line.

## Out of scope

- The delivery itself, its log lines and texts (F147).
- The schedules and job names (P2).
