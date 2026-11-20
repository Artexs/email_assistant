import { describe, expect, test } from "bun:test";

import { ACTION_ID_HEADER, ACTION_ID_HEADER_KEY } from "./headers";

describe("action id header", () => {
  test("the wire name keeps its spelling", () => {
    expect(ACTION_ID_HEADER).toBe("X-EA-Action-Id");
  });

  test("the key of lower-cased header maps is the lower-case name", () => {
    expect(ACTION_ID_HEADER_KEY).toBe("x-ea-action-id");
    expect(ACTION_ID_HEADER_KEY).toBe(ACTION_ID_HEADER.toLowerCase());
  });
});
