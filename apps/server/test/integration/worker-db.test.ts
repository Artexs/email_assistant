import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { workerDatabaseName } from "../worker-db";

import { testDb } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("worker databases of test:int", () => {
  test("names: the base database and the worker id make the name db:worktree takes", () => {
    expect(workerDatabaseName("email_assistant", "2")).toBe("w2");
    expect(workerDatabaseName("email_assistant_2026_11_19_abc", "3")).toBe("2026_11_19_abc_w3");
    expect(() => workerDatabaseName("other", "1")).toThrow("worker databases need a base database");
  });

  // Only `test:int` sets EA_TEST_WORKER_DB; a serial run of one file uses the database of `.env`.
  test.skipIf(process.env.EA_TEST_WORKER_DB !== "1")(
    "a worker process runs its files on its own database",
    async () => {
      const { rows } = await sql<{ name: string }>`select current_database() as name`.execute(db);
      expect(rows[0]?.name).toMatch(new RegExp(`_w${process.env.BUN_TEST_WORKER_ID}$`));
    }
  );

  test("test:unit and test:int run their files in 4 worker processes; test:int gives each worker a database", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../../../package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:unit"]).toContain("bun test --parallel=4 ");
    expect(pkg.scripts["test:int"]).toContain("EA_TEST_WORKER_DB=1 bun test --parallel=4 ");
  });
});
