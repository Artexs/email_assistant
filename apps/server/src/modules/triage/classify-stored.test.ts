import { categories } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { wouldMoveOf } from "./classify-stored";

describe("wouldMoveOf: assist mode with the default switches and auto on", () => {
  test("info, notification and spam move; the other categories do not", () => {
    const moving = categories.filter((category) => wouldMoveOf(category, { vip: false }));
    expect(moving.sort()).toEqual(["info", "notification", "spam"]);
  });

  test("a VIP mail is never moved", () => {
    expect(wouldMoveOf("info", { vip: true })).toBe(false);
  });

  test("unsure stays put: the move_unsure switch is off in assist mode", () => {
    expect(wouldMoveOf("unsure", { vip: false })).toBe(false);
  });

  test("mail from the Junk folder: urgent and needs_reply move back, the plan of the category decides", () => {
    expect(wouldMoveOf("urgent", { vip: false, fromJunk: true })).toBe(true);
  });
});
