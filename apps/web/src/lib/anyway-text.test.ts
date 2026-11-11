import { describe, expect, test } from "bun:test";
import { barCategories } from "@ea/core/web";

import { en } from "../i18n/en";

import { anywayTextKey } from "./anyway-text";

describe("anywayTextKey", () => {
  test("both texts exist", () => {
    expect(Object.hasOwn(en, "anyway_text")).toBe(true);
    expect(Object.hasOwn(en, "anyway_text_quiet")).toBe(true);
  });

  test("urgent and needs_reply get the quiet text, the others the move text", () => {
    for (const category of barCategories) {
      const quiet = category === "urgent" || category === "needs_reply";
      expect(anywayTextKey(category)).toBe(quiet ? "anyway_text_quiet" : "anyway_text");
    }
  });
});
