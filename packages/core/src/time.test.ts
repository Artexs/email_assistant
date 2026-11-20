import { describe, expect, test } from "bun:test";

import { addDays, DAY_MS, HOUR_MS, MINUTE_MS } from "./time";

describe("time constants", () => {
  test("a minute, an hour and a day in milliseconds", () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(3_600_000);
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe("addDays", () => {
  test("moves across month, year and leap-day edges", () => {
    expect(addDays("2026-11-18", 0)).toBe("2026-11-18");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("moves by a week and by many days", () => {
    expect(addDays("2026-11-16", 7)).toBe("2026-11-23");
    expect(addDays("2026-11-16", -7)).toBe("2026-11-09");
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
    expect(addDays("2026-11-18", -400)).toBe("2025-10-14");
  });
});

describe("one definition", () => {
  test("no source file outside the tests defines its own DAY_MS or HOUR_MS (or dayMs, hourMs)", async () => {
    const root = new URL("../../../", import.meta.url).pathname;
    const own: string[] = [];
    for (const pattern of ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts", "tools/*/src/**/*.ts"]) {
      for await (const path of new Bun.Glob(pattern).scan({ cwd: root })) {
        if (path.endsWith("/time.ts") || path.includes("node_modules") || /\.test\.ts$/.test(path)) continue;
        const text = await Bun.file(`${root}${path}`).text();
        if (/^\s*(export )?(const|let) (day|hour)_?ms\b/im.test(text)) own.push(path);
      }
    }
    expect(own).toEqual([]);
  });
});
