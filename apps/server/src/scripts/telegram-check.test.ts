import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "telegram-check.ts");
const token = "123456:UNREACHABLEaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TIMEOUT_MS = 20_000;

// Port 1 refuses the connection at once. `--no-env-file` keeps a developer `.env` out; the two required config keys are set here.
describe("telegram:check with an unreachable Telegram", () => {
  test(
    "exits 3 with one `unreachable:` line and no token",
    async () => {
      const proc = Bun.spawn(["bun", "--no-env-file", script], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL || "postgres://app:app@127.0.0.1:1/none",
          CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
          TELEGRAM_BOT_TOKEN: token,
          TELEGRAM_API_ROOT: "http://127.0.0.1:1",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect({ code, stdout, stderr: stderr.trim() }).toEqual({
        code: 3,
        stdout: "",
        stderr: "[telegram-check] unreachable: SoftError",
      });
      expect(stdout + stderr).not.toContain(token);
    },
    TIMEOUT_MS
  );
});
