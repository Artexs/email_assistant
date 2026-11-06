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
});
