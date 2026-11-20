import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const root = resolve(import.meta.dir, "../../../..");
const entry = resolve(import.meta.dir, "org-status.ts");
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const TIMEOUT_MS = 15_000;

// The test preload's config env (`process.env`), with a database that refuses the connection: nothing listens on port 1.
// `CREDENTIALS_KEY` has a fallback for a lane with no `.env`; `--no-env-file` keeps the run free of a `.env` of the checkout.
async function run(databaseUrl: string) {
  const proc = Bun.spawn(["bun", "--no-env-file", entry, "--org-id", ORG_ID], {
    cwd: root,
    env: {
      ...process.env,
      CREDENTIALS_KEY: process.env.CREDENTIALS_KEY ?? Buffer.alloc(32, 1).toString("base64"),
      DATABASE_URL: databaseUrl,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("org:status with an unreachable database", () => {
  test(
    "exits 3 with one `unreachable:` line and no stack",
    async () => {
      const result = await run("postgres://ea:x@127.0.0.1:1/ea");

      expect(result.code).toBe(3);
      expect(result.stdout).toBe("");
      const lines = result.stderr.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toStartWith("[org-status] unreachable:");
      expect(result.stderr).not.toContain("at ");
    },
    TIMEOUT_MS
  );
});
