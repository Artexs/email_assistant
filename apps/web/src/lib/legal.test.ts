import { describe, expect, test } from "bun:test";

import { legalPath } from "./legal";

describe("legalPath", () => {
  test("joins the language and the document", () => {
    expect(legalPath("en", "dpa")).toBe("/legal/en/dpa");
    expect(legalPath("pl", "terms")).toBe("/legal/pl/terms");
  });
});
