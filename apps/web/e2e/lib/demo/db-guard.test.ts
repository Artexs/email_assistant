import { describe, expect, test } from "bun:test";

import { demoDbProblem } from "./db-guard";

const dev = "postgres://u:p@h:5432/ea_dev";
const e2e = "postgres://u:p@h:5432/ea_e2e";

describe("demoDbProblem", () => {
  test("accepts a database whose name ends in _demo and that no other URL names", () => {
    expect(demoDbProblem("postgres://h/ea_demo", [dev, e2e])).toBeNull();
    expect(demoDbProblem("postgres://h/ea_demo", [undefined, ""])).toBeNull();
  });

  test("refuses a name that does not end in _demo", () => {
    expect(demoDbProblem("postgres://h/ea_dev", [])).toBe("demo_db_refused");
    expect(demoDbProblem("postgres://h/ea_demo_old", [])).toBe("demo_db_refused");
  });

  test("refuses the database of DATABASE_URL or E2E_DATABASE_URL, whatever the user and the default port", () => {
    expect(demoDbProblem("postgres://h/x_demo", [dev, "postgres://h/x_demo"])).toBe("demo_db_refused");
    expect(demoDbProblem("postgres://a:b@h:5432/x_demo", ["postgres://c:d@h/x_demo"])).toBe("demo_db_refused");
  });

  test("accepts the same name on another host or port", () => {
    expect(demoDbProblem("postgres://h:5433/x_demo", ["postgres://h/x_demo"])).toBeNull();
  });

  test("refuses a URL that does not parse or names no database", () => {
    expect(demoDbProblem("not a url", [])).toBe("demo_db_refused");
    expect(demoDbProblem("postgres://h/", [])).toBe("demo_db_refused");
  });
});
