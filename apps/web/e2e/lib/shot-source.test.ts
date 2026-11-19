import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { DEFAULT_DEMO_SEED_FILE, shotSource } from "./shot-source";

describe("shotSource", () => {
  test("T1 no env and no file is the e2e seed; the default file makes it the demo seed", () => {
    expect(shotSource({}, () => false)).toEqual({ kind: "e2e" });
    expect(shotSource({}, (path) => path === DEFAULT_DEMO_SEED_FILE)).toEqual({
      kind: "demo",
      file: DEFAULT_DEMO_SEED_FILE,
    });
  });
  test("T1 the default file stands in apps/web/e2e/demo", () => {
    expect(DEFAULT_DEMO_SEED_FILE.endsWith("/apps/web/e2e/demo/demo-seed.json")).toBe(true);
  });
  test("T1 an env path that exists is the demo seed; a missing one throws demo_seed_missing, also when the default file exists", () => {
    const file = resolve("/tmp/some-seed.json");
    expect(shotSource({ DEMO_SEED_FILE: file }, (path) => path === file)).toEqual({ kind: "demo", file });
    expect(() => shotSource({ DEMO_SEED_FILE: file }, () => false)).toThrow("demo_seed_missing");
    expect(() => shotSource({ DEMO_SEED_FILE: file }, (path) => path === DEFAULT_DEMO_SEED_FILE)).toThrow(
      "demo_seed_missing"
    );
  });
  test("an empty env value counts as not set", () => {
    expect(shotSource({ DEMO_SEED_FILE: "" }, () => false)).toEqual({ kind: "e2e" });
  });
});
