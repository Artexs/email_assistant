import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { categoryTag } from "./labels";

describe("categoryTag", () => {
  test("the emoji and the name of the locale", () => {
    expect(categoryTag("urgent", textTables.pl)).toBe("🔴 Pilne");
    expect(categoryTag("delegation", textTables.en)).toBe("👥 Delegate");
  });
});
