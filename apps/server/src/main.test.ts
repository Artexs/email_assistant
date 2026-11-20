import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

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

  // The release stamp: the entry point reads EA_RELEASE before it logs, so every JSON line carries it. The job-run
  // half is in `test/integration/job-run-cli.test.ts`.
  test("every JSON line of main.ts carries EA_RELEASE", async () => {
    const proc = Bun.spawn(["bun", mainPath], {
      cwd: tmpdir(),
      env: {
        PATH: process.env.PATH ?? "",
        DATABASE_URL: "postgres://app:x@127.0.0.1:1/x",
        CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
        EA_RELEASE: "test-r1",
        LOG_FORMAT: "json",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const lineOf = (text: string, event: string) =>
      text
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as { event?: string; release?: string })
        .find((entry) => entry.event === event);

    expect(exitCode).toBe(1);
    expect(lineOf(stdout, "features_off")?.release).toBe("test-r1");
    expect(lineOf(stderr, "db_role_check_failed")?.release).toBe("test-r1");
  });
});
