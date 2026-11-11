import { describe, expect, test } from "bun:test";

import { isDirty, nextDraft, startDraft } from "./draft";

describe("draft", () => {
  test("a clean draft takes the new server value", () => {
    expect(nextDraft({ server: "a", value: "a" }, "b")).toEqual({ server: "b", value: "b" });
  });

  test("a dirty draft keeps the typing", () => {
    expect(nextDraft({ server: "a", value: "x" }, "b")).toEqual({ server: "b", value: "x" });
  });

  test("startDraft and isDirty", () => {
    expect(startDraft("a")).toEqual({ server: "a", value: "a" });
    expect(isDirty({ server: "a", value: "a" })).toBe(false);
    expect(isDirty({ server: "a", value: "b" })).toBe(true);
    expect(isDirty({ server: null as string | null, value: "b" })).toBe(true);
  });

  test("arrays compare by content", () => {
    expect(isDirty({ server: ["08:00"], value: ["08:00"] })).toBe(false);
    expect(isDirty({ server: ["08:00"], value: ["08:00", "12:00"] })).toBe(true);
    expect(nextDraft({ server: ["08:00"], value: ["08:00"] }, ["09:00"])).toEqual({
      server: ["09:00"],
      value: ["09:00"],
    });
  });
});
