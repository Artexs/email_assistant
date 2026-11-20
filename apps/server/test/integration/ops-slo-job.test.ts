import { OPERATOR_ALERT_KINDS, type SloKind } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  createOperatorDelivery,
  runSloTick,
  sendTestAlerts,
  checkBackupAge,
  checkDisk,
  checkUrgentLatency,
  type SloCheckEntry,
  type SloReading,
  type SloTickDeps,
} from "../../src/modules/operator";
import { loadConfig, sloThresholds } from "../../src/platform/config";
import { currentTenantScope, withTenantScope, type DB } from "../../src/platform/db";
import { runJobTick } from "../../src/platform/scheduler";

import { createOrgWithMailbox, insertTriaged, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// One tick of the `ops.slo` job against `ops_alerts`, with a fake send, a fake clock and fake checks.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const cfg = sloThresholds(
  loadConfig({
    DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/x",
    CREDENTIALS_KEY: Buffer.alloc(32).toString("base64"),
  })
);
const T0 = new Date("2026-11-20T10:00:00Z");
const plus = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);
const MINUTE = 1;
const HOUR = 60;

// The test runs in a transaction that rolls back; it first hides the rows of other runs.
async function inRollback(fn: (trx: Trx) => Promise<void>): Promise<void> {
  await withRollback(db, async (trx) => {
    await trx.deleteFrom("ops_alerts").execute();
    await fn(trx);
  });
}

interface LogLine {
  level: "info" | "warn" | "error";
  event: string;
  fields: Record<string, unknown>;
}

function harness(trx: Trx) {
  const sent: string[] = [];
  const lines: LogLine[] = [];
  const state = { failSend: false };
  const log = {
    info: (event: string, fields?: Record<string, unknown>) =>
      void lines.push({ level: "info", event, fields: fields ?? {} }),
    warn: (event: string, fields?: Record<string, unknown>) =>
      void lines.push({ level: "warn", event, fields: fields ?? {} }),
    error: (event: string, fields?: Record<string, unknown>) =>
      void lines.push({ level: "error", event, fields: fields ?? {} }),
  };
  const send = async (text: string): Promise<void> => {
    if (state.failSend) throw new Error("telegram down: secret chat 123");
    sent.push(text);
  };
  // A new deps object for each tick: a restart keeps no memory between ticks.
  const deps = (checks: SloCheckEntry[], withSend = true): SloTickDeps => ({
    db: trx,
    checks,
    delivery: createOperatorDelivery({ send: withSend ? send : null, log }),
    cfg,
    log,
    locale: "en",
  });
  return { sent, lines, state, deps };
}

function reading(
  kind: SloKind,
  state: "firing" | "between" | "clear",
  facts: Record<string, number>,
  ids: string[] = []
): SloReading {
  return { check: { kind, state, facts }, ids };
}

const entry = (kind: SloKind, value: SloReading | null | Error): SloCheckEntry => ({
  kind,
  run: async () => {
    if (value instanceof Error) throw value;
    return value;
  },
});

const diskFiring = reading("slo_disk", "firing", { free_pct: 12.3, free_gb: 1.8 });
const diskClear = reading("slo_disk", "clear", { free_pct: 40, free_gb: 60 });

async function rows(trx: Trx, kind: SloKind) {
  const { rows: found } = await sql<{
    notice_count: number;
    open_sent_at: Date | null;
    last_sent_at: Date | null;
    resolved_at: Date | null;
    resolved_sent_at: Date | null;
  }>`select notice_count, open_sent_at, last_sent_at, resolved_at, resolved_sent_at from ops_alerts where kind = ${kind} order by id`.execute(
    trx
  );
  return found;
}

describe("the ops.slo tick", () => {
  test("1. a firing disk opens: one send, line 1 `ALERT slo_disk`, notice_count 1", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.split("\n")[0]).toBe("ALERT slo_disk");
      expect(h.sent[0]).toContain("Free 12.3 % (1.8 GB)");
      expect(h.sent[0]?.split("\n").at(-1)).toBe("Runbook: docs/known-alerts.md#slo_disk");
      const found = await rows(trx, "slo_disk");
      expect(found).toHaveLength(1);
      expect(found[0]?.notice_count).toBe(1);
      expect(h.lines).toEqual([
        { level: "info", event: "operator_alert_sent", fields: { kind: "slo_disk", status: "open" } },
      ]);
    });
  });

  test("2. five minutes later, still firing, on a new deps object (restart): no send", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(5 * MINUTE));
      expect(h.sent).toHaveLength(1);
      expect((await rows(trx, "slo_disk"))[0]?.notice_count).toBe(1);
    });
  });

  test("3. six hours later: one `STILL OPEN` send, count 2; 5 h 59 min earlier: none", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(6 * HOUR - 1));
      expect(h.sent).toHaveLength(1);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(6 * HOUR));
      expect(h.sent).toHaveLength(2);
      expect(h.sent[1]?.split("\n")[0]).toBe("STILL OPEN slo_disk (since 2026-11-20T10:00:00.000Z)");
      expect((await rows(trx, "slo_disk"))[0]?.notice_count).toBe(2);
      // A tick in the same minute after the repeat sends nothing more.
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(6 * HOUR + 5 * MINUTE));
      expect(h.sent).toHaveLength(2);
    });
  });

  test("4. clear after 6 h 5 min: one `RESOLVED` send (open 365 min); the next clear tick: none", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(6 * HOUR));
      await runSloTick(h.deps([entry("slo_disk", diskClear)]), plus(6 * HOUR + 5 * MINUTE));
      expect(h.sent).toHaveLength(3);
      expect(h.sent[2]?.split("\n")[0]).toBe("RESOLVED slo_disk (open 365 min)");
      expect(h.sent[2]).toContain("Free 40.0 % (60.0 GB)");
      const [row] = await rows(trx, "slo_disk");
      expect(row?.resolved_sent_at?.getTime()).toBe(plus(6 * HOUR + 5 * MINUTE).getTime());
      await runSloTick(h.deps([entry("slo_disk", diskClear)]), plus(6 * HOUR + 10 * MINUTE));
      expect(h.sent).toHaveLength(3);
      // The same kind can open again as a new incident.
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(7 * HOUR));
      expect(h.sent).toHaveLength(4);
      expect(await rows(trx, "slo_disk")).toHaveLength(2);
    });
  });

  test("4b. a resolved send that fails writes no mark; the next tick sends it once and marks it once", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      h.state.failSend = true;
      await runSloTick(h.deps([entry("slo_disk", diskClear)]), plus(10 * MINUTE));
      let [row] = await rows(trx, "slo_disk");
      expect(row?.resolved_at?.getTime()).toBe(plus(10 * MINUTE).getTime());
      expect(row?.resolved_sent_at).toBeNull();
      h.state.failSend = false;
      await runSloTick(h.deps([entry("slo_disk", diskClear)]), plus(15 * MINUTE));
      expect(h.sent).toHaveLength(2);
      // The length of the incident ends at the first clear tick, not at the late send.
      expect(h.sent[1]?.split("\n")[0]).toBe("RESOLVED slo_disk (open 10 min)");
      [row] = await rows(trx, "slo_disk");
      expect(row?.resolved_at?.getTime()).toBe(plus(10 * MINUTE).getTime());
      expect(row?.resolved_sent_at?.getTime()).toBe(plus(15 * MINUTE).getTime());
      // The mark is not written twice: a later clear tick changes nothing.
      await runSloTick(h.deps([entry("slo_disk", diskClear)]), plus(20 * MINUTE));
      expect(h.sent).toHaveLength(2);
      [row] = await rows(trx, "slo_disk");
      expect(row?.resolved_sent_at?.getTime()).toBe(plus(15 * MINUTE).getTime());
    });
  });

  test("5. a send that throws on open writes no mark; the next tick sends open again; one row", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      h.state.failSend = true;
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      let found = await rows(trx, "slo_disk");
      expect(found).toHaveLength(1);
      expect(found[0]?.open_sent_at).toBeNull();
      expect(found[0]?.notice_count).toBe(0);
      expect(h.lines).toEqual([
        {
          level: "error",
          event: "operator_alert_send_failed",
          fields: { kind: "slo_disk", status: "open", error: "Error" },
        },
      ]);
      h.state.failSend = false;
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), plus(5 * MINUTE));
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.split("\n")[0]).toBe("ALERT slo_disk");
      found = await rows(trx, "slo_disk");
      expect(found).toHaveLength(1);
      expect(found[0]?.notice_count).toBe(1);
      expect(found[0]?.open_sent_at?.getTime()).toBe(plus(5 * MINUTE).getTime());
    });
  });

  test("6. an open send that failed, then a clear reading: silent close, no resolved send", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      h.state.failSend = true;
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      h.state.failSend = false;
      await runSloTick(h.deps([entry("slo_disk", diskClear)]), plus(5 * MINUTE));
      expect(h.sent).toHaveLength(0);
      const [row] = await rows(trx, "slo_disk");
      expect(row?.resolved_sent_at?.getTime()).toBe(plus(5 * MINUTE).getTime());
      expect(row?.notice_count).toBe(0);
    });
  });

  test("7. with no send (no operator chat): no send call, the `warn` line `operator_alert_unsent` counts as the send, the row is marked", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)], false), T0);
      expect(h.sent).toHaveLength(0);
      expect(h.lines).toEqual([
        { level: "warn", event: "operator_alert_unsent", fields: { kind: "slo_disk", status: "open" } },
      ]);
      const [row] = await rows(trx, "slo_disk");
      expect(row?.notice_count).toBe(1);
      expect(row?.open_sent_at?.getTime()).toBe(T0.getTime());
      // The step counts as sent: the next tick does not log it again.
      await runSloTick(h.deps([entry("slo_disk", diskFiring)], false), plus(5 * MINUTE));
      expect(h.lines).toHaveLength(1);
    });
  });

  test("8. a sync check that throws logs `operator_check_failed` with its kind; the disk alert still opens", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      const boom = Object.assign(new Error("the subject was Secret plan"), { code: "XX001" });
      await runSloTick(h.deps([entry("slo_sync_lag", boom), entry("slo_disk", diskFiring)]), T0);
      expect(h.lines).toEqual([
        {
          level: "error",
          event: "operator_check_failed",
          fields: { kind: "slo_sync_lag", error: "Error", error_code: "XX001" },
        },
        { level: "info", event: "operator_alert_sent", fields: { kind: "slo_disk", status: "open" } },
      ]);
      expect(JSON.stringify(h.lines)).not.toContain("Secret");
      expect(h.sent).toHaveLength(1);
      expect(await rows(trx, "slo_sync_lag")).toHaveLength(0);
    });
  });

  test("8b. a check that is off (null) skips its kind: an open alert of the kind stays as it is", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps([entry("slo_disk", diskFiring)]), T0);
      await runSloTick(h.deps([entry("slo_disk", null)]), plus(7 * HOUR));
      expect(h.sent).toHaveLength(1);
      const [row] = await rows(trx, "slo_disk");
      expect(row?.resolved_at).toBeNull();
    });
  });

  test("8c. the kinds run in SLO_KINDS order, whatever the order of the list", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      const checks = [
        entry("slo_disk", diskFiring),
        entry("slo_sync_lag", reading("slo_sync_lag", "firing", { mailboxes: 1, max_lag_min: 20 }, ["a"])),
      ];
      await runSloTick(h.deps(checks), T0);
      expect(h.sent.map((text) => text.split("\n")[0])).toEqual(["ALERT slo_sync_lag", "ALERT slo_disk"]);
    });
  });

  test("8d. a state error of one kind does not stop the others", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      const deps = h.deps([
        entry("slo_sync_lag", reading("slo_sync_lag", "firing", { mailboxes: Number.NEGATIVE_INFINITY })),
      ]);
      // The facts are not a finite number: the repository refuses them, the tick logs the kind and goes on.
      await runSloTick({ ...deps, checks: [...deps.checks, entry("slo_disk", diskFiring)] }, T0);
      expect(h.lines[0]).toMatchObject({
        level: "error",
        event: "operator_alert_failed",
        fields: { kind: "slo_sync_lag" },
      });
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.split("\n")[0]).toBe("ALERT slo_disk");
    });
  });

  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  test("8e. the tick runs with no tenant scope when the scheduler runs it", async () => {
    const seen: (string | null)[] = [];
    const check: SloCheckEntry = {
      kind: "slo_disk",
      run: async () => {
        seen.push(currentTenantScope());
        return null;
      },
    };
    await withTenantScope("11111111-1111-4111-8111-111111111111", () =>
      runJobTick("ops.slo", () =>
        runSloTick(
          {
            db,
            checks: [check],
            delivery: createOperatorDelivery({ send: null, log: quiet }),
            cfg,
            log: quiet,
            locale: "en",
          },
          T0
        )
      )
    );
    expect(seen).toEqual([null]);
  });
});

describe("the text of a real reading", () => {
  test("9. a late urgent mail: the text holds the mail id, not the subject and not an address", async () => {
    await inRollback(async (trx) => {
      await trx.updateTable("organizations").set({ plan: "suspended" }).execute();
      const org = await createOrgWithMailbox(trx);
      await trx
        .updateTable("mailboxes")
        .set({ last_synced_at: null, status_changed_at: new Date("2026-11-20T08:00:00Z") })
        .where("id", "=", org.mailboxId)
        .execute();
      await linkChat(trx, { orgId: org.orgId }, org.userId, randomChatId(), new Date("2026-11-01T08:00:00Z"));
      const emailId = await insertTriaged(trx, { orgId: org.orgId }, org.mailboxId, {
        category: "urgent",
        createdAt: new Date("2026-11-20T09:00:00Z"),
        subject: "Secret plan",
        from: "ceo@x.test",
      });
      const h = harness(trx);
      const urgent: SloCheckEntry = {
        kind: "slo_urgent_latency",
        run: (now) => checkUrgentLatency(trx, now, cfg, new Date("2026-11-20T08:00:00Z"), { senders: [] }),
      };
      await runSloTick(h.deps([urgent]), T0);
      expect(h.sent).toHaveLength(1);
      const text = h.sent[0] ?? "";
      expect(text).toContain(emailId);
      expect(text.split("\n")[0]).toBe("ALERT slo_urgent_latency");
      expect(text).toContain("1 urgent mail not told in time, longest wait 60 min");
      expect(text).not.toContain("Secret");
      expect(text).not.toContain("ceo");
      expect(text).not.toContain("@");
      expect(JSON.stringify(h.lines)).not.toContain(emailId);
    });
  });
});

// The rows a test send must not write: incident rows and operator notice audit rows (other runs may leave some).
async function counts(trx: Trx): Promise<{ alerts: number; notices: number }> {
  const { rows: found } = await sql<{ alerts: number; notices: number }>`
    select (select count(*)::int from ops_alerts) as alerts,
           (select count(*)::int from audit_log where event = 'operator.notice') as notices`.execute(trx);
  return found[0] ?? { alerts: -1, notices: -1 };
}

describe("ops:alert-test", () => {
  test("11. --all with a fake send: ten sends, each line 1 `TEST <kind>`; no ops_alerts row and no operator.notice row", async () => {
    await inRollback(async (trx) => {
      const sent: string[] = [];
      const reported: string[] = [];
      const before = await counts(trx);
      const results = await sendTestAlerts({
        kinds: OPERATOR_ALERT_KINDS,
        send: async (text) => void sent.push(text),
        now: T0,
        locale: "en",
        report: (result) => void reported.push(`${result.outcome} ${result.kind}`),
      });
      expect(sent.map((text) => text.split("\n")[0])).toEqual(OPERATOR_ALERT_KINDS.map((kind) => `TEST ${kind}`));
      expect(results.map((result) => result.outcome)).toEqual(OPERATOR_ALERT_KINDS.map(() => "sent"));
      expect(reported).toEqual(OPERATOR_ALERT_KINDS.map((kind) => `sent ${kind}`));
      expect(await counts(trx)).toEqual(before);
    });
  });

  test("11b. no chat: `no_chat` for the kind, no send; a send error stops the run and reaches the caller", async () => {
    const none = await sendTestAlerts({ kinds: ["slo_disk"], send: null, now: T0, locale: "en" });
    expect(none).toEqual([{ kind: "slo_disk", outcome: "no_chat" }]);
    const reported: string[] = [];
    await expect(
      sendTestAlerts({
        kinds: ["slo_disk", "slo_backup_age"],
        send: async (text) => {
          if (text.startsWith("TEST slo_backup_age")) throw new Error("down");
        },
        now: T0,
        locale: "en",
        report: (result) => void reported.push(result.kind),
      })
    ).rejects.toThrow("down");
    expect(reported).toEqual(["slo_disk"]);
  });
});

// The real disk and backup-age checks as `SloCheckEntry` objects, through the whole tick and the texts.
describe("the ops.slo tick with the disk and backup-age checks", () => {
  const backupCfg = { ...cfg, backupStatusFile: "/run/ea-backup/status.json" };
  const entries = (statfs: Parameters<typeof checkDisk>[0], file: () => Promise<string>): SloCheckEntry[] => [
    { kind: "slo_disk", run: () => checkDisk(statfs, backupCfg) },
    { kind: "slo_backup_age", run: (now) => checkBackupAge(file, now, backupCfg) },
  ];
  const lowDisk = async () => ({ blocks: 1000, bsize: 4096 * 1024, bavail: 129 });
  const goodDisk = async () => ({ blocks: 1000, bsize: 4096 * 1024, bavail: 800 });
  const noFile = async (): Promise<string> => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  const goodFile = async (): Promise<string> =>
    `{"result":"ok","at":"2026-11-20T03:30:05Z","name":"ea-x.dump.age","bytes":10,"last_ok_at":"2026-11-20T03:30:05Z"}`;

  test("9. a low disk and a missing status file each open once, with the real fact names in the text", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps(entries(lowDisk, noFile)), T0);
      expect(h.sent).toHaveLength(2);
      expect(h.sent[0]?.split("\n").slice(0, 2)).toEqual(["ALERT slo_disk", "Free 12.9 % (0.5 GB)"]);
      expect(h.sent[1]?.split("\n").slice(0, 2)).toEqual(["ALERT slo_backup_age", "No backup status file"]);
      expect(await rows(trx, "slo_disk")).toHaveLength(1);
      expect(await rows(trx, "slo_backup_age")).toHaveLength(1);
      // five minutes later, nothing changed: no new text
      await runSloTick(h.deps(entries(lowDisk, noFile)), plus(5 * MINUTE));
      expect(h.sent).toHaveLength(2);
    });
  });

  test("9b. both resolve when the disk has space and the status file is good", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      await runSloTick(h.deps(entries(lowDisk, noFile)), T0);
      await runSloTick(h.deps(entries(goodDisk, goodFile)), plus(10 * MINUTE));
      expect(h.sent.map((text) => text.split("\n")[0])).toEqual([
        "ALERT slo_disk",
        "ALERT slo_backup_age",
        "RESOLVED slo_disk (open 10 min)",
        "RESOLVED slo_backup_age (open 10 min)",
      ]);
    });
  });

  test("9c. with no BACKUP_STATUS_FILE the backup entry reads nothing and opens nothing", async () => {
    await inRollback(async (trx) => {
      const h = harness(trx);
      const off: SloCheckEntry[] = [
        { kind: "slo_backup_age", run: (now) => checkBackupAge(noFile, now, { ...cfg, backupStatusFile: null }) },
      ];
      await runSloTick(h.deps(off), T0);
      expect(h.sent).toEqual([]);
      expect(await rows(trx, "slo_backup_age")).toHaveLength(0);
    });
  });
});
