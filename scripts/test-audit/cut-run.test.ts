import { describe, expect, test } from "bun:test";
import { splitLanes } from "./cut-run";

const UNIT = ["deploy/test", "packages/core", "apps/server/src"];
const INT = ["apps/server/test", "tools/fake-telegram/test"];

describe("cut run lane split", () => {
  test("a file goes to the lane whose path holds it, and a file in neither lane is unknown", () => {
    const lanes = splitLanes(
      ["apps/server/test/integration/a.test.ts", "packages/core/src/b.test.ts", "notes/c.test.ts"],
      UNIT,
      INT
    );
    expect(lanes).toEqual({
      unit: ["packages/core/src/b.test.ts"],
      int: ["apps/server/test/integration/a.test.ts"],
      unknown: ["notes/c.test.ts"],
    });
  });

  test("a path matches whole folders only and a leading ./ is dropped", () => {
    const lanes = splitLanes(["./packages/core/x.test.ts", "packages/core-extra/y.test.ts"], UNIT, INT);
    expect(lanes).toEqual({ unit: ["packages/core/x.test.ts"], int: [], unknown: ["packages/core-extra/y.test.ts"] });
  });
});
