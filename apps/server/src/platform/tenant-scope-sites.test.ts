import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// Plan D16, D18 (RLS safety net, ADR 0011): only these places call the scope functions, and only the driver writes
// app.org_id. A new call site fails here until the plan names it.
const SERVER_SRC = join(import.meta.dir, "..");

const files = readdirSync(SERVER_SRC, { recursive: true, encoding: "utf8" })
  .map((name) => name.split("\\").join("/"))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

const filesWith = (...needles: string[]): string[] =>
  files
    .filter((name) => needles.some((needle) => readFileSync(join(SERVER_SRC, name), "utf8").includes(needle)))
    .sort();

describe("the call sites of the tenant scope", () => {
  test("only requireTenant and the two operator services of the DSR call withTenantScope", () => {
    // The DSR find and erase run for one organization named by the operator: their scope backs up the org filter (F106).
    expect(filesWith("withTenantScope(")).toEqual([
      "modules/privacy/dsr.ts",
      "modules/privacy/erase.ts",
      "platform/http.ts",
    ]);
  });

  test("only requireOperator and the job tick call withoutTenantScope", () => {
    expect(filesWith("withoutTenantScope(")).toEqual(["platform/http.ts", "platform/scheduler.ts"]);
  });

  test("only the driver writes app.org_id", () => {
    expect(filesWith("set_config('app.org_id'", "SET app.org_id", "SET LOCAL app.org_id")).toEqual([
      "platform/db/scoped-driver.ts",
    ]);
  });

  test("the scan read the tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });
});
