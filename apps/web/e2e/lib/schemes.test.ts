import { describe, expect, test } from "bun:test";

import { DARK_SCAN_ON, defaultSchemes } from "./schemes";

describe("defaultSchemes", () => {
  test("the dark scan is on: the desktop project scans both schemes, the mobile project light only", () => {
    expect(DARK_SCAN_ON).toBe(true);
    expect(defaultSchemes("desktop")).toEqual(["light", "dark"]);
    expect(defaultSchemes("mobile")).toEqual(["light"]);
  });

  test("the dark scan is off: both projects scan the light scheme only", () => {
    expect(defaultSchemes("desktop", false)).toEqual(["light"]);
    expect(defaultSchemes("mobile", false)).toEqual(["light"]);
  });
});
