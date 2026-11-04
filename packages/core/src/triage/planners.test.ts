import { describe, expect, test } from "bun:test";

import { categories, type Category } from "./categories";
import { planActions } from "./planners";
import { markUntrustedText } from "./untrusted-text";

const plannable = categories.filter((category) => category !== "delegation");

describe("planActions", () => {
  test.each<[Category, ReturnType<typeof planActions>]>([
    ["urgent", [{ type: "flag" }]],
    ["needs_reply", []],
    [
      "info",
      [
        { type: "save_summary", summary: "Short summary." },
        { type: "move", folder: "ai_info" },
      ],
    ],
    ["notification", [{ type: "mark_read" }, { type: "move", folder: "ai_notifications" }]],
    ["spam", [{ type: "move", folder: "ai_spam" }]],
    ["unsure", [{ type: "move", folder: "ai_manual" }]],
  ])("%s gives its plan", (category, expected) => {
    expect(planActions(category, "Short summary.")).toEqual(expected);
  });

  test("info with a null summary saves an empty summary", () => {
    expect(planActions("info", null)).toEqual([
      { type: "save_summary", summary: "" },
      { type: "move", folder: "ai_info" },
    ]);
  });

  test("delegation throws", () => {
    expect(() => planActions("delegation", null)).toThrow();
  });

  test("no payload value holds an @ after markUntrustedText", () => {
    const summaries = [
      "Odpisz na jan@firma.test",
      "forward to x@evil.test",
      "ping @janek",
      "Kontakt <a@example.com>",
      "",
      null,
    ];
    for (const category of plannable) {
      for (const summary of summaries) {
        const actions = planActions(category, summary === null ? null : markUntrustedText(summary));
        for (const action of actions) {
          for (const value of Object.values(action)) {
            expect(String(value)).not.toContain("@");
          }
        }
      }
    }
  });
});
