import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { startSource } from "./start/source.test-helper";

const mainPath = join(import.meta.dir, "main.ts");

describe("main", () => {
  test("exits with code 1 and names the key when DATABASE_URL is missing", async () => {
    const proc = Bun.spawn(["bun", mainPath], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: "" },
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("DATABASE_URL");
  });

  test("exits with code 1, names the key and hides the value when TELEGRAM_BOT_TOKEN is bad", async () => {
    const proc = Bun.spawn(["bun", mainPath], {
      cwd: tmpdir(),
      env: {
        PATH: process.env.PATH ?? "",
        DATABASE_URL: "postgres://app:x@127.0.0.1:1/x",
        CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
        TELEGRAM_BOT_TOKEN: "abc",
      },
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("TELEGRAM_BOT_TOKEN");
    expect(stderr).not.toContain("abc");
  });

  // Source-level pin of the wiring: the `ops.slo` tick sends through the one operator send that
  // `channels.operator` also gets (a function when OPERATOR_TELEGRAM_CHAT_ID is set, null when it is unset).
  test("the ops.slo job and the operator notices share one operator send", () => {
    const source = startSource();
    expect(source).toMatch(/const operatorSend =\s+operatorChat === null\s+\? null\s+: async/);
    expect(source).toMatch(
      /createOperatorNotices\(\{\s+db,\s+now: \(\) => new Date\(\),\s+send: operatorSend,\s+locale: config\.OPERATOR_LOCALE,\s+\}\)/
    );
    expect(source).toMatch(/scheduler\.add\("ops\.slo", "30 \*\/5 \* \* \* \*",[\s\S]*?send: operatorSend,/);
  });

  // main.ts and the job runner stamp the release on every JSON line.
  test("main.ts and the job-run script call setLogRelease with the config value", () => {
    expect(readFileSync(mainPath, "utf8")).toContain("setLogRelease(config.EA_RELEASE);");
    expect(readFileSync(join(import.meta.dir, "scripts", "job-run.ts"), "utf8")).toContain(
      "setLogRelease(config.EA_RELEASE);"
    );
  });

  // The disk and backup-age checks are entries `{kind, run}` of the `ops.slo` check list (not bare functions),
  // and the job runs that list.
  test("the ops.slo check list holds the disk and backup-age entries", () => {
    const source = startSource();
    expect(source).toContain(`{ kind: "slo_disk", run: () => checkDisk(statfs, slo) }`);
    expect(source).toMatch(
      /\{ kind: "slo_backup_age", run: \(now\) => checkBackupAge\(\(path\) => readFile\(path, "utf8"\), now, slo\) \}/
    );
    expect(source).toMatch(/runSloTick\(\s*\{ db, checks: sloChecks,/);
  });
});
