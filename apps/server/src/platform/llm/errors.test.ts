import { describe, expect, test } from "bun:test";

import { configCodes, softCodes, type ConfigCode, type SoftCode } from "./errors";

// A Record over the type has one key per member: a member that the type gains makes this file fail to compile.
const everySoftCode: Record<SoftCode, true> = {
  http_429: true,
  http_500: true,
  http_502: true,
  http_503: true,
  http_504: true,
  http_5xx: true,
  timeout: true,
  network: true,
};
const everyConfigCode: Record<ConfigCode, true> = {
  http_401: true,
  http_402: true,
  http_403: true,
  http_404: true,
  http_400_key: true,
  http_400_precondition: true,
  http_429_quota: true,
  http_400_schema: true,
  schema_not_strict: true,
  missing_key: true,
};

describe("the runtime code lists", () => {
  test("softCodes holds every SoftCode once", () => {
    expect([...softCodes].sort() as string[]).toEqual(Object.keys(everySoftCode).sort());
  });

  test("configCodes holds every ConfigCode once", () => {
    expect([...configCodes].sort() as string[]).toEqual(Object.keys(everyConfigCode).sort());
  });

  test("no code is in both lists", () => {
    expect(softCodes.filter((code) => (configCodes as readonly string[]).includes(code))).toEqual([]);
  });
});
