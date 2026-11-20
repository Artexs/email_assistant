import { describe, expect, test } from "bun:test";

import type { TelegramRuntime } from "../modules/channels";
import type { createOperatorNotices, OperatorDelivery, runSloTick, SloCheckEntry } from "../modules/operator";
import { loadConfig } from "../platform/config";
import { createLog } from "../platform/log";

import { createStartContext } from "./context";
import { startOperator, type OperatorStartDeps } from "./operator";

const AT = new Date("2026-11-20T03:00:00.000Z");
const TOKEN = "123456:ABCdefGhIJKlmNoPQRstuVWxyZ_-12345";
const baseEnv = {
  DATABASE_URL: "postgres://app:x@127.0.0.1:1/x",
  CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
};
const chatEnv = { OPERATOR_TELEGRAM_CHAT_ID: "4242", TELEGRAM_BOT_TOKEN: TOKEN };

type NoticeDeps = Parameters<typeof createOperatorNotices>[0];
type TickDeps = Parameters<typeof runSloTick>[0];

// Starts the operator wiring with spies in place of its consumers; returns what they recorded.
function start(env: Record<string, string>, io?: Partial<OperatorStartDeps["io"]>) {
  const ctx = createStartContext({
    config: loadConfig({ ...baseEnv, ...env }),
    db: {} as never,
    log: createLog("test"),
    startedAt: AT,
  });
  const added: [string, string, () => Promise<void>][] = [];
  ctx.scheduler = { add: (name, pattern, fn) => void added.push([name, pattern, fn]), stop: () => undefined };
  const sent: [number, string][] = [];
  const noticeRuns: number[] = [];
  const noticeDeps: NoticeDeps[] = [];
  const tickDeps: TickDeps[] = [];
  const deps: OperatorStartDeps = {
    io: {
      statfs: io?.statfs ?? (async () => ({ bavail: 1, blocks: 1, bsize: 1 })),
      readFile: io?.readFile ?? (async () => ""),
    },
    createOperatorNotices: ((given: NoticeDeps) => {
      noticeDeps.push(given);
      return { run: async () => void noticeRuns.push(1) };
    }) as unknown as typeof createOperatorNotices,
    runSloTick: (async (given: TickDeps) => void tickDeps.push(given)) as typeof runSloTick,
  };
  startOperator(ctx, deps);
  ctx.late.telegram = {
    sendDirect: async (chat: number, text: string) => void sent.push([chat, text]),
  } as unknown as TelegramRuntime;
  const job = async (name: string) => {
    const entry = added.find(([added]) => added === name);
    if (entry === undefined) throw new Error(`no job ${name}`);
    await entry[2]();
  };
  return { added, sent, noticeRuns, noticeDeps, tickDeps, job };
}

async function started(env: Record<string, string>, io?: Partial<OperatorStartDeps["io"]>) {
  const run = start(env, io);
  await run.job("ops.slo");
  const tick = run.tickDeps[0];
  if (tick === undefined) throw new Error("ops.slo did not run the tick");
  return { ...run, tick };
}

const checkOf = (tick: TickDeps, kind: SloCheckEntry["kind"]): SloCheckEntry => {
  const entry = tick.checks.find((c) => c.kind === kind);
  if (entry === undefined) throw new Error(`no check ${kind}`);
  return entry;
};

const alert = { kind: "slo_disk", status: "open", key: "alert-1" } as const;

describe("startOperator", () => {
  test("schedules the notices and the tick, which share one delivery", async () => {
    const run = start(chatEnv);
    expect(run.added.map(([name, pattern]) => [name, pattern])).toEqual([
      ["channels.operator", "0 13 * * * *"],
      ["ops.slo", "30 */5 * * * *"],
    ]);
    await run.job("channels.operator");
    await run.job("ops.slo");

    expect(run.noticeRuns).toEqual([1]);
    expect(run.tickDeps).toHaveLength(1);
    expect(run.noticeDeps[0]?.delivery).toBe(run.tickDeps[0]?.delivery as OperatorDelivery);
  });

  test("delivers to the operator chat through the Telegram runtime set later", async () => {
    const { tick, sent } = await started({ ...chatEnv });

    expect(await tick.delivery.deliver(alert, "text-1")).toBe(true);
    expect(sent).toEqual([[4242, "text-1"]]);
  });

  test("counts a text as delivered and sends nothing when there is no operator chat", async () => {
    const { tick, sent } = await started({});

    expect(await tick.delivery.deliver(alert, "text-1")).toBe(true);
    expect(sent).toEqual([]);
  });

  test("the tick runs the five checks in order", async () => {
    const { tick } = await started({});

    expect(tick.checks.map((c) => c.kind)).toEqual([
      "slo_sync_lag",
      "slo_urgent_latency",
      "slo_llm_errors",
      "slo_disk",
      "slo_backup_age",
    ]);
  });

  test("the disk check reads the volume through io.statfs", async () => {
    const paths: string[] = [];
    const { tick } = await started(
      { SLO_DISK_PATH: "/srv/disk", SLO_DISK_FREE_PCT: "10", SLO_DISK_FREE_GB: "1" },
      {
        statfs: async (path) => {
          paths.push(path);
          return { bavail: 5, blocks: 100, bsize: 4096 };
        },
      }
    );

    const reading = await checkOf(tick, "slo_disk").run(AT);
    expect(paths).toEqual(["/srv/disk"]);
    expect(reading?.check).toEqual({ kind: "slo_disk", state: "firing", facts: { free_pct: 5, free_gb: 0 } });
  });

  test("the backup check reads the status file through io.readFile", async () => {
    const paths: string[] = [];
    const status = JSON.stringify({
      result: "ok",
      at: "2026-11-20T00:00:00.000Z",
      name: null,
      bytes: null,
      last_ok_at: "2026-11-20T00:00:00.000Z",
    });
    const { tick } = await started(
      { BACKUP_STATUS_FILE: "/srv/backup.json", SLO_BACKUP_MAX_AGE_H: "26" },
      {
        readFile: async (path) => {
          paths.push(path);
          return status;
        },
      }
    );

    const reading = await checkOf(tick, "slo_backup_age").run(AT);
    expect(paths).toEqual(["/srv/backup.json"]);
    expect(reading?.check).toEqual({
      kind: "slo_backup_age",
      state: "clear",
      facts: { age_h: 3, failed: 0, missing: 0 },
    });
  });
});
