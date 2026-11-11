import { describe, expect, test } from "bun:test";

import { filterTimeZones } from "./timezones";

const list = ["Europe/Warsaw", "Europe/London", "America/New_York", "UTC"];

describe("filterTimeZones", () => {
  test("a query with a space matches an underscore", () => {
    expect(filterTimeZones(list, "new york", "Europe/Warsaw")).toEqual(["America/New_York"]);
  });

  test("the current zone comes first when it matches", () => {
    expect(filterTimeZones(list, "europe", "Europe/London")).toEqual(["Europe/London", "Europe/Warsaw"]);
  });

  test("an empty query shows the current zone first, even when the list lacks it", () => {
    expect(filterTimeZones(list, "", "Asia/Tokyo")).toEqual(["Asia/Tokyo", ...list]);
  });

  test("the cap of 50 includes the current zone", () => {
    const many = Array.from({ length: 60 }, (_, i) => `Zone/N${i}`);
    const result = filterTimeZones(many, "", "Asia/Tokyo");
    expect(result).toHaveLength(50);
    expect(result[0]).toBe("Asia/Tokyo");
  });

  test("no duplicates", () => {
    expect(filterTimeZones(list, "", "UTC").filter((z) => z === "UTC")).toHaveLength(1);
  });
});
