import { describe, expect, test } from "bun:test";

import { tripwireDue } from "./tripwire";

const at = (iso: string) => new Date(iso);

describe("tripwireDue", () => {
  test("two corrections in the 7 days before now", () => {
    const result = tripwireDue({
      corrections: [
        { at: at("2026-11-02T12:00:00Z"), important: false },
        { at: at("2026-11-07T12:00:00Z"), important: false },
      ],
      now: at("2026-11-08T09:00:00Z"),
    });
    expect(result).toBe("corrections");
  });
  test("a correction older than 7 days does not count", () => {
    const result = tripwireDue({
      corrections: [
        { at: at("2026-10-31T12:00:00Z"), important: false },
        { at: at("2026-11-07T10:00:00Z"), important: false },
      ],
      now: at("2026-11-08T11:00:00Z"),
    });
    expect(result).toBeNull();
  });
  test("the window edge is inclusive", () => {
    const result = tripwireDue({
      corrections: [
        { at: at("2026-11-01T09:00:00Z"), important: false },
        { at: at("2026-11-07T10:00:00Z"), important: false },
      ],
      now: at("2026-11-08T09:00:00Z"),
    });
    expect(result).toBe("corrections");
  });
  test("one important correction trips at once; one other does not", () => {
    const now = at("2026-11-08T09:00:00Z");
    expect(tripwireDue({ corrections: [{ at: at("2026-11-07T10:00:00Z"), important: true }], now })).toBe(
      "important_hidden"
    );
    expect(tripwireDue({ corrections: [{ at: at("2026-11-07T10:00:00Z"), important: false }], now })).toBeNull();
  });
  test("an important correction outside the window does not trip", () => {
    const now = at("2026-11-08T09:00:00Z");
    expect(tripwireDue({ corrections: [{ at: at("2026-10-20T10:00:00Z"), important: true }], now })).toBeNull();
  });
  test("a correction after now does not count", () => {
    const now = at("2026-11-08T09:00:00Z");
    const corrections = [
      { at: at("2026-11-07T10:00:00Z"), important: false },
      { at: at("2026-11-09T10:00:00Z"), important: false },
    ];
    expect(tripwireDue({ corrections, now })).toBeNull();
  });
  test("no corrections", () => {
    expect(tripwireDue({ corrections: [], now: at("2026-11-08T09:00:00Z") })).toBeNull();
  });
});
