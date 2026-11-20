import { renderSloAlert } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { loadConfig, sloThresholds } from "../../platform/config";

import { checkBackupAge, checkDisk, type SloReading, type StatFs } from "./slo-checks";

// The disk and backup-age checks. Both read the host through an injected function, so no test touches the disk.
const cfg = sloThresholds(
  loadConfig({
    DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/x",
    CREDENTIALS_KEY: Buffer.alloc(32).toString("base64"),
    BACKUP_STATUS_FILE: "/run/ea-backup/status.json",
  })
);
const NOW = new Date("2026-11-20T10:00:00Z");
const GIB = 1024 ** 3;
const BSIZE = 4096;

// A volume of `totalGb` GiB with `freePct` percent free. The block counts are whole numbers, so the percent has no float error.
function volume(totalGb: number, freePct: number): StatFs {
  const blocks = (totalGb * GIB) / BSIZE;
  return async () => ({ blocks, bsize: BSIZE, bavail: (blocks * freePct) / 100 });
}

describe("checkDisk", () => {
  test("6. firing below either limit, between inside the band, clear above both", async () => {
    const low = await checkDisk(volume(50, 14.9), cfg);
    expect(low.check).toEqual({ kind: "slo_disk", state: "firing", facts: { free_pct: 14.9, free_gb: 7.5 } });
    expect(low.ids).toEqual([]);
    expect((await checkDisk(volume(60, 17), cfg)).check.state).toBe("between");
    const clear = await checkDisk(volume(12.5, 20), cfg);
    expect(clear.check).toEqual({ kind: "slo_disk", state: "clear", facts: { free_pct: 20, free_gb: 2.5 } });
    // 30 % of 6.3 GB = 1.9 GB: the percent is fine, the gigabytes are not
    expect((await checkDisk(volume(6.3, 30), cfg)).check).toMatchObject({ state: "firing", facts: { free_gb: 1.9 } });
  });

  test("6b. the limits are exact: at the open value it is not firing, one step under the clear value it is between", async () => {
    expect((await checkDisk(volume(100, 15), cfg)).check.state).toBe("between");
    expect((await checkDisk(volume(100, 14.99), cfg)).check.state).toBe("firing");
    expect((await checkDisk(volume(100, 19.99), cfg)).check.state).toBe("between");
    // free GB at 2.0 (the open value) is between; 2.5 is clear; the percent is high in both
    expect((await checkDisk(volume(5, 40), cfg)).check.state).toBe("between");
    expect((await checkDisk(volume(5, 50), cfg)).check.state).toBe("clear");
    expect((await checkDisk(volume(5, 39.9), cfg)).check.state).toBe("firing");
  });

  test("6c. it reads the configured path, and a failed or empty read throws", async () => {
    const seen: string[] = [];
    await checkDisk(
      async (path) => {
        seen.push(path);
        return { blocks: 100, bsize: BSIZE, bavail: 50 };
      },
      { ...cfg, diskPath: "/data" }
    );
    expect(seen).toEqual(["/data"]);
    await expect(checkDisk(async () => Promise.reject(new Error("ENOENT")), cfg)).rejects.toThrow("ENOENT");
    await expect(checkDisk(async () => ({ blocks: 0, bsize: BSIZE, bavail: 0 }), cfg)).rejects.toThrow(RangeError);
  });
});

function statusFile(fields: Record<string, unknown>): (path: string) => Promise<string> {
  const body = {
    result: "ok",
    at: "2026-11-20T03:30:05Z",
    name: "ea-20261120T033005Z.dump.age",
    bytes: 1234,
    last_ok_at: "2026-11-20T03:30:05Z",
    ...fields,
  };
  return async () => `${JSON.stringify(body)}\n`;
}

describe("checkBackupAge", () => {
  test("7. no file fires with missing 1", async () => {
    const reader = async (): Promise<string> => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const result = await checkBackupAge(reader, NOW, cfg);
    expect(result?.check).toEqual({
      kind: "slo_backup_age",
      state: "firing",
      facts: { age_h: -1, failed: 0, missing: 1 },
    });
    expect(result?.ids).toEqual([]);
  });

  test("7b. an ok run fires after 26 h and is clear before", async () => {
    const old = await checkBackupAge(statusFile({ last_ok_at: "2026-11-19T07:59:00Z" }), NOW, cfg);
    expect(old?.check).toMatchObject({ state: "firing", facts: { age_h: 26, failed: 0, missing: 0 } });
    const fresh = await checkBackupAge(statusFile({ last_ok_at: "2026-11-19T08:01:00Z" }), NOW, cfg);
    expect(fresh?.check).toMatchObject({ state: "clear", facts: { age_h: 25, failed: 0, missing: 0 } });
    const line = await checkBackupAge(statusFile({ last_ok_at: "2026-11-19T08:00:00Z" }), NOW, cfg);
    expect(line?.check.state).toBe("clear");
    // the limit comes from the config
    const wide = await checkBackupAge(statusFile({ last_ok_at: "2026-11-19T07:59:00Z" }), NOW, {
      ...cfg,
      backupMaxAgeH: 30,
    });
    expect(wide?.check.state).toBe("clear");
  });

  test("7c. a failed run fires even with a fresh last_ok_at", async () => {
    const failed = statusFile({ result: "failed", name: null, bytes: null, last_ok_at: "2026-11-20T03:30:05Z" });
    expect((await checkBackupAge(failed, NOW, cfg))?.check).toMatchObject({
      state: "firing",
      facts: { age_h: 6, failed: 1, missing: 0 },
    });
    const never = statusFile({ result: "failed", name: null, bytes: null, last_ok_at: null });
    expect((await checkBackupAge(never, NOW, cfg))?.check).toMatchObject({
      state: "firing",
      facts: { age_h: -1, failed: 1, missing: 0 },
    });
  });

  test("7d. a file that is not the status shape fires as missing", async () => {
    for (const body of [
      "{",
      "",
      "[]",
      `{"result":"ok"}`,
      `{"result":"maybe","at":"2026-11-20T03:30:05Z","name":null,"bytes":null,"last_ok_at":null}`,
      `{"result":"ok","at":"yesterday","name":null,"bytes":null,"last_ok_at":"2026-11-20T03:30:05Z"}`,
    ]) {
      const result = await checkBackupAge(async () => body, NOW, cfg);
      expect(result?.check).toMatchObject({ state: "firing", facts: { missing: 1, age_h: -1 } });
    }
    // an ok run with no last_ok_at gives no age: the check fires
    const noOk = await checkBackupAge(statusFile({ last_ok_at: null }), NOW, cfg);
    expect(noOk?.check).toMatchObject({ state: "firing", facts: { age_h: -1, failed: 0, missing: 0 } });
  });

  test("7e. a last_ok_at in the future counts as age 0", async () => {
    const result = await checkBackupAge(statusFile({ last_ok_at: "2026-11-20T12:00:00Z" }), NOW, cfg);
    expect(result?.check).toMatchObject({ state: "clear", facts: { age_h: 0 } });
  });

  test("7f. an empty BACKUP_STATUS_FILE turns the check off and reads nothing", async () => {
    let reads = 0;
    const reader = async (): Promise<string> => {
      reads += 1;
      return "";
    };
    expect(await checkBackupAge(reader, NOW, { ...cfg, backupStatusFile: null })).toBeNull();
    expect(reads).toBe(0);
    await checkBackupAge(reader, NOW, cfg);
    expect(reads).toBe(1);
  });
});

describe("the real readings fill the stage 03 texts", () => {
  const text = (reading: SloReading | null): string[] => {
    if (reading === null) throw new Error("the check is off");
    return renderSloAlert(
      { kind: reading.check.kind, phase: "open", facts: reading.check.facts, ids: [], openedAt: NOW, now: NOW },
      "en"
    ).split("\n");
  };

  test("8. missing status file: line 2 says no status file", async () => {
    const reading = await checkBackupAge(() => Promise.reject(new Error("ENOENT")), NOW, cfg);
    expect(text(reading)[1]).toBe("No backup status file");
  });

  test("8b. the other backup states and the disk read in words from the real facts", async () => {
    const stale = await checkBackupAge(statusFile({ last_ok_at: "2026-11-19T07:59:00Z" }), NOW, cfg);
    expect(text(stale)[1]).toBe("Last good backup 26 h ago");
    const failed = await checkBackupAge(statusFile({ result: "failed", name: null, bytes: null }), NOW, cfg);
    expect(text(failed)[1]).toBe("Last backup run failed; last good backup 6 h ago");
    expect(text(await checkDisk(volume(50, 14.9), cfg))[1]).toBe("Free 14.9 % (7.5 GB)");
  });
});
