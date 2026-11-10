import { describe, expect, test } from "bun:test";

import { databaseNameOf, isE2eDatabaseName, seedFilePath, seedTargetOk } from "./e2e-seed-args";

const e2eApp = "postgres://app:x@127.0.0.1:5433/email_assistant_e2e";
const e2eMigrator = "postgres://migrator:x@127.0.0.1:5433/email_assistant_e2e";
const devApp = "postgres://app:x@127.0.0.1:5433/email_assistant";
const devMigrator = "postgres://migrator:x@127.0.0.1:5433/email_assistant";

describe("databaseNameOf", () => {
  test("returns the name without the leading slash", () => {
    expect(databaseNameOf(e2eApp)).toBe("email_assistant_e2e");
  });

  test("returns null for text that does not parse", () => {
    expect(databaseNameOf("not a url")).toBeNull();
  });

  test("returns null for a scheme that is not postgres", () => {
    expect(databaseNameOf("socket:/run/pg_e2e?db=email_assistant")).toBeNull();
  });

  test("does not take the name from a database query parameter, like pg", () => {
    expect(isE2eDatabaseName(databaseNameOf("postgres://app:x@h:1/?database=x_e2e"))).toBe(false);
  });

  test("does not return an e2e name for an empty path", () => {
    expect(isE2eDatabaseName(databaseNameOf("postgres://app:x@h:1"))).toBe(false);
  });
});

describe("isE2eDatabaseName", () => {
  test("accepts only names that end in _e2e", () => {
    expect(isE2eDatabaseName("email_assistant_e2e")).toBe(true);
    expect(isE2eDatabaseName("other_e2e")).toBe(true);
    expect(isE2eDatabaseName("email_assistant")).toBe(false);
    expect(isE2eDatabaseName("email_assistant_s5b")).toBe(false);
    expect(isE2eDatabaseName(null)).toBe(false);
    expect(isE2eDatabaseName("_e2e")).toBe(false);
    expect(isE2eDatabaseName("a-b_e2e")).toBe(false);
  });
});

describe("seedTargetOk", () => {
  test("accepts two URLs for the same e2e database", () => {
    expect(seedTargetOk(e2eApp, e2eMigrator)).toEqual({ ok: true, database: "email_assistant_e2e" });
  });

  test("refuses a dev DATABASE_URL", () => {
    const result = seedTargetOk(devApp, e2eMigrator);
    expect(result).toEqual({ ok: false, reason: "DATABASE_URL is not an e2e database (email_assistant)" });
  });

  test("refuses a dev MIGRATOR_DATABASE_URL", () => {
    const result = seedTargetOk(e2eApp, devMigrator);
    expect(result).toEqual({ ok: false, reason: "MIGRATOR_DATABASE_URL is not an e2e database (email_assistant)" });
  });

  test("refuses two different e2e databases", () => {
    const result = seedTargetOk("postgres://app:x@h:1/a_e2e", "postgres://migrator:x@h:1/b_e2e");
    expect(result).toEqual({ ok: false, reason: "the two URLs name different databases (a_e2e, b_e2e)" });
  });

  test("refuses the socket form that pg reads as the dev database", () => {
    expect(seedTargetOk("socket:/run/pg_e2e?db=email_assistant", e2eMigrator).ok).toBe(false);
    expect(seedTargetOk(e2eApp, "socket:/run/pg_e2e?db=email_assistant").ok).toBe(false);
  });

  test("refuses an empty migrator URL", () => {
    expect(seedTargetOk(e2eApp, "").ok).toBe(false);
  });
});

describe("seedFilePath", () => {
  test("puts the file in the web e2e folder", () => {
    expect(seedFilePath("/r")).toBe("/r/apps/web/e2e/.seed.json");
  });
});
