import { describe, expect, test } from "bun:test";

import { deadlinesInWindow } from "./classifier-extras";

describe("deadlinesInWindow", () => {
  test("5. today 2027-01-15 keeps the deadlines 2027-01-14 and 2027-02-14, not 01-13 and 02-15", () => {
    const deadlines = ["2027-01-13", "2027-01-14", "2027-02-14", "2027-02-15"].map((due) => ({ label: due, due }));
    expect(deadlinesInWindow("2027-01-15", deadlines).map((deadline) => deadline.due)).toEqual([
      "2027-01-14",
      "2027-02-14",
    ]);
  });

  test("the window follows month and year ends", () => {
    const deadlines = ["2026-12-31", "2027-01-30", "2027-01-31"].map((due) => ({ label: due, due }));
    expect(deadlinesInWindow("2027-01-01", deadlines).map((deadline) => deadline.due)).toEqual([
      "2026-12-31",
      "2027-01-30",
      "2027-01-31",
    ]);
    expect(
      deadlinesInWindow("2027-03-01", [
        { label: "x", due: "2027-03-31" },
        { label: "y", due: "2027-04-01" },
      ])
    ).toEqual([{ label: "x", due: "2027-03-31" }]);
  });
});
