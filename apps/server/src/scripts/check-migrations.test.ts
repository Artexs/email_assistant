import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { parseCheckMigrationsArgs } from "./check-migrations-args";
import { CONTRACT_CHECK_AFTER } from "./lib/check-migrations-rules";

const script = join(import.meta.dir, "check-migrations.ts");
const cutoff = "20260101000000";
const newName = "20260201000000_case.sql";
let work = "";
let counter = 0;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "f114-s06-run-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

interface Result {
  code: number;
  lines: string[];
}

/** Runs the real CLI on one fixture folder with the cutoff `20260101000000`. */
async function check(files: Record<string, string>, after = cutoff): Promise<Result> {
  counter += 1;
  const dir = join(work, `case-${counter}`);
  mkdirSync(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const run = Bun.spawn([process.execPath, script, "--dir", dir, "--after", after], { stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(run.stdout).text(), run.exited]);
  const lines = stdout
    .split("\n")
    .filter((line) => line.includes(".sql:"))
    .map((line) => line.replace(`${dir}/`, "").replace("[check-migrations] ", ""));
  return { code, lines };
}

const up = (body: string) => `-- migrate:up\n${body}\n\n-- migrate:down\nSELECT 1;\n`;
const one = (body: string) => check({ [newName]: up(body) });

describe("check-migrations", () => {
  test("1. DROP COLUMN is a finding", async () => {
    const result = await one("ALTER TABLE a DROP COLUMN b;");
    expect(result.code).toBe(1);
    expect(result.lines).toEqual([`${newName}:2 drop_column`]);
  });

  test("1b. DROP without the word COLUMN is a finding too", async () => {
    const result = await one("ALTER TABLE a\n  ADD COLUMN c text,\n  DROP b;");
    expect(result.lines).toEqual([`${newName}:4 drop_column`]);
  });

  test("2. a contract line allows the file", async () => {
    const result = await check({ [newName]: `-- contract: v0.2.0\n${up("ALTER TABLE a DROP COLUMN b;")}` });
    expect(result).toEqual({ code: 0, lines: [] });
  });

  test("2b. a contract line without a version does not allow it", async () => {
    const result = await check({ [newName]: `-- contract:\n${up("ALTER TABLE a DROP COLUMN b;")}` });
    expect(result.code).toBe(1);
  });

  test("3. DROP INDEX is a finding unless the file creates the index again", async () => {
    const drop = await one("DROP INDEX x;");
    expect(drop.code).toBe(1);
    expect(drop.lines).toEqual([`${newName}:2 drop_index`]);
    const replace = await one("DROP INDEX IF EXISTS x;\nCREATE UNIQUE INDEX x ON a (b);");
    expect(replace.code).toBe(0);
  });

  test("4. DROP CONSTRAINT is a finding unless the file adds the constraint again", async () => {
    const replace = await one(
      "ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;\nALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind <> '');"
    );
    expect(replace.code).toBe(0);
    const drop = await one("ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;");
    expect(drop.lines).toEqual([`${newName}:2 drop_constraint`]);
  });

  test("5. a comment is not read", async () => {
    const result = await one("-- DROP TABLE x\n/* DROP TABLE y;\nTRUNCATE z; */\nSELECT 1;");
    expect(result).toEqual({ code: 0, lines: [] });
  });

  test("5b. a string is not read", async () => {
    const result = await one("COMMENT ON TABLE a IS 'DROP TABLE x; -- TRUNCATE';\nSELECT 1;");
    expect(result).toEqual({ code: 0, lines: [] });
  });

  test("6. a statement under migrate:down is not read", async () => {
    const result = await check({ [newName]: "-- migrate:up\nSELECT 1;\n\n-- migrate:down\nDROP TABLE x;\n" });
    expect(result).toEqual({ code: 0, lines: [] });
  });

  test("7. a column type change is a finding in both spellings", async () => {
    const result = await one(
      "ALTER TABLE a ALTER COLUMN b TYPE text;\nALTER TABLE a ALTER COLUMN b SET DATA TYPE text;"
    );
    expect(result.lines).toEqual([`${newName}:2 alter_column_type`, `${newName}:3 alter_column_type`]);
  });

  test("8. RENAME is a finding in any form", async () => {
    const column = await one("ALTER TABLE a RENAME COLUMN b TO c;");
    expect(column.lines).toEqual([`${newName}:2 rename`]);
    const table = await one("ALTER TABLE a RENAME TO c;");
    expect(table.lines).toEqual([`${newName}:2 rename`]);
    const value = await one("ALTER TYPE t RENAME VALUE 'a' TO 'b';");
    expect(value.code).toBe(1);
    const word = await one("ALTER TABLE a ADD COLUMN renamed_at timestamptz;");
    expect(word.code).toBe(0);
  });

  test("9. a file at or before the cutoff is not read", async () => {
    const old = await check({
      "20260101000000_old.sql": up("DROP TABLE x;"),
      "20251231000000_older.sql": up("DROP TABLE x;"),
    });
    expect(old).toEqual({ code: 0, lines: [] });
    const after = await check({ "20260101000001_new.sql": up("DROP TABLE x;") });
    expect(after.lines).toEqual(["20260101000001_new.sql:2 drop_table"]);
  });

  test("10. DROP FUNCTION is a finding unless the file creates the function again", async () => {
    const replace = await one(
      "DROP FUNCTION f(int);\nCREATE OR REPLACE FUNCTION public.f(a int) RETURNS int AS $$ SELECT a $$ LANGUAGE sql;"
    );
    expect(replace.code).toBe(0);
    const drop = await one("DROP FUNCTION f(int);");
    expect(drop.lines).toEqual([`${newName}:2 drop_function`]);
  });

  test("10b. DROP TRIGGER and DROP POLICY follow the same replace rule", async () => {
    const trigger = await one("DROP TRIGGER t ON a;");
    expect(trigger.lines).toEqual([`${newName}:2 drop_trigger`]);
    const policy = await one("DROP POLICY p ON a;");
    expect(policy.lines).toEqual([`${newName}:2 drop_policy`]);
    const replace = await one(
      "DROP POLICY p ON a;\nCREATE POLICY p ON a USING (true);\nDROP TRIGGER t ON a;\nCREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW EXECUTE FUNCTION f();"
    );
    expect(replace.code).toBe(0);
  });

  test("11. SET NOT NULL is a finding", async () => {
    const result = await one("ALTER TABLE a ALTER COLUMN b SET NOT NULL;");
    expect(result.lines).toEqual([`${newName}:2 set_not_null`]);
  });

  test("12. TRUNCATE and REVOKE are findings", async () => {
    expect((await one("TRUNCATE a;")).lines).toEqual([`${newName}:2 truncate`]);
    expect((await one("REVOKE ALL ON a FROM app;")).lines).toEqual([`${newName}:2 revoke`]);
  });

  test("12b. ADD CONSTRAINT is a finding unless the file creates the table", async () => {
    const add = await one("ALTER TABLE a ADD CONSTRAINT c CHECK (b > 0);");
    expect(add.lines).toEqual([`${newName}:2 add_constraint`]);
    const unnamed = await one("ALTER TABLE a ADD CHECK (b > 0);");
    expect(unnamed.lines).toEqual([`${newName}:2 add_constraint`]);
    const created = await one("CREATE TABLE a (b int);\nALTER TABLE a ADD CONSTRAINT c CHECK (b > 0);");
    expect(created.code).toBe(0);
  });

  test("12c. the drop rules for the other object kinds", async () => {
    const result = await one(
      [
        "DROP TABLE IF EXISTS a;",
        "DROP TYPE t;",
        "DROP VIEW v;",
        "DROP MATERIALIZED VIEW m;",
        "DROP SCHEMA s;",
        "DROP SEQUENCE q;",
        "DROP EXTENSION e;",
      ].join("\n")
    );
    expect(result.lines.map((line) => line.split(" ")[1])).toEqual([
      "drop_table",
      "drop_type",
      "drop_view",
      "drop_view",
      "drop_schema",
      "drop_sequence",
      "drop_extension",
    ]);
  });

  test("12d. safe expand statements pass", async () => {
    const result = await one(
      [
        "CREATE TABLE a (id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'x');",
        "ALTER TABLE b ADD COLUMN c text;",
        "ALTER TABLE b ALTER COLUMN c SET DEFAULT 'y';",
        "ALTER TABLE b ALTER COLUMN c DROP NOT NULL;",
        "CREATE INDEX b_c ON b (c);",
        "ALTER TYPE t ADD VALUE 'z';",
        "GRANT SELECT ON b TO app;",
      ].join("\n")
    );
    expect(result).toEqual({ code: 0, lines: [] });
  });

  test("13. the migrations of this repository pass with the default cutoff", async () => {
    const run = Bun.spawn([process.execPath, script], {
      cwd: join(import.meta.dir, "../../../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(run.stdout).text();
    expect(await run.exited).toBe(0);
    expect(out).toContain("ok:");
  });

  test("14. a bad argument gives the usage and exit 2", async () => {
    const run = Bun.spawn([process.execPath, script, "--after", "soon"], { stdout: "pipe", stderr: "pipe" });
    const err = await new Response(run.stderr).text();
    expect(await run.exited).toBe(2);
    expect(err).toContain("usage:");
  });
});

describe("parseCheckMigrationsArgs", () => {
  test("defaults and bad input", () => {
    expect(parseCheckMigrationsArgs([])).toEqual({ dir: "db/migrations", after: CONTRACT_CHECK_AFTER });
    expect(parseCheckMigrationsArgs(["--dir", "x", "--after", "20260101000000"])).toEqual({
      dir: "x",
      after: "20260101000000",
    });
    expect(parseCheckMigrationsArgs(["--after", "123"])).toBeNull();
    expect(parseCheckMigrationsArgs(["extra"])).toBeNull();
    expect(parseCheckMigrationsArgs(["--dir", ""])).toBeNull();
  });
});

describe("CI wiring", () => {
  test("the ci job runs the check before db:migrate, and the package script exists", () => {
    const repo = join(import.meta.dir, "../../../..");
    const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("\n  ci:"), ci.indexOf("\n  e2e:"));
    const check = job.indexOf("- run: bun run db:check-migrations");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(job.indexOf("- run: bun run db:migrate"));
    const scripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["db:check-migrations"]).toContain("check-migrations.ts");
  });
});
