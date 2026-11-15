import { describe, expect, test } from "bun:test";

import { localToInstant } from "../digest/local-time";

import { defaultDue, dueRefSchema, resolveDue, type DueRef } from "./dates";

const timeZone = "Europe/Warsaw";
const at = (date: string, time: string) => localToInstant(date, time, timeZone);
const word = (value: string) => ({ kind: "word", word: value }) as DueRef;
const date = (value: string): DueRef => ({ kind: "date", date: value });
const due = (ref: DueRef, sentAt: Date) => resolveDue(ref, { sentAt, timeZone })?.toISOString() ?? null;
const iso = (day: string, time = "17:00") => at(day, time).toISOString();

describe("resolveDue (T2b)", () => {
  const wednesday = at("2026-11-18", "10:00");

  test("words resolve from the local day of the sent mail", () => {
    expect(due(word("friday"), wednesday)).toBe(iso("2026-11-20"));
    expect(due(word("end_of_week"), wednesday)).toBe(iso("2026-11-20"));
    expect(due(word("tomorrow"), wednesday)).toBe(iso("2026-11-19"));
    expect(due(word("today"), wednesday)).toBe(iso("2026-11-18"));
    expect(due(word("next_week"), wednesday)).toBe(iso("2026-11-23"));
  });

  test("a weekday word is the next such day, never the same day", () => {
    expect(due(word("wednesday"), wednesday)).toBe(iso("2026-11-25"));
    expect(due(word("thursday"), wednesday)).toBe(iso("2026-11-19"));
    expect(due(word("tuesday"), wednesday)).toBe(iso("2026-11-24"));
  });

  test("end_of_week on Friday: this Friday before 17:00, the next Friday after it", () => {
    expect(due(word("end_of_week"), at("2026-11-20", "18:00"))).toBe(iso("2026-11-27"));
    expect(due(word("end_of_week"), at("2026-11-20", "10:00"))).toBe(iso("2026-11-20"));
    expect(due(word("end_of_week"), at("2026-11-20", "17:00"))).toBe(iso("2026-11-27"));
  });

  test("end_of_week and next_week on a weekend", () => {
    expect(due(word("end_of_week"), at("2026-11-21", "09:00"))).toBe(iso("2026-11-27"));
    expect(due(word("end_of_week"), at("2026-11-22", "09:00"))).toBe(iso("2026-11-27"));
    expect(due(word("next_week"), at("2026-11-22", "09:00"))).toBe(iso("2026-11-23"));
  });

  test("the local day decides: 00:30 Warsaw is still the previous UTC day", () => {
    expect(due(word("tomorrow"), at("2026-11-18", "00:30"))).toBe(iso("2026-11-19"));
  });

  test("a Saturday in March: Monday 17:00 is CEST", () => {
    const result = due(word("monday"), at("2026-03-28", "10:00"));
    expect(result).toBe("2026-03-30T15:00:00.000Z");
    expect(result).toBe(iso("2026-03-30"));
  });

  test("a date is 17:00 local on that day", () => {
    expect(due(date("2026-11-25"), wednesday)).toBe(iso("2026-11-25"));
  });

  test("a date before the sent mail gives null", () => {
    expect(due(date("2026-11-17"), wednesday)).toBeNull();
    expect(due(word("today"), at("2026-11-18", "18:00"))).toBeNull();
  });

  test("more than 60 days ahead gives null; day 60 holds", () => {
    expect(due(date("2027-01-20"), wednesday)).toBeNull();
    expect(due(date("2027-01-18"), wednesday)).toBeNull();
    expect(due(date("2027-01-17"), wednesday)).toBe(iso("2027-01-17"));
  });

  test("a date that does not exist gives null", () => {
    expect(due(date("2026-02-30"), at("2026-02-01", "10:00"))).toBeNull();
  });
});

describe("defaultDue", () => {
  test("3 working days from Friday 10:00 is Wednesday 17:00", () => {
    expect(defaultDue(at("2026-11-20", "10:00"), 3, timeZone).toISOString()).toBe(iso("2026-11-25"));
  });

  test("a Saturday start counts from Monday", () => {
    expect(defaultDue(at("2026-11-21", "10:00"), 1, timeZone).toISOString()).toBe(iso("2026-11-23"));
  });
});

describe("dueRefSchema", () => {
  test("accepts a date and a word; refuses an unknown word and extra keys", () => {
    expect(dueRefSchema.safeParse(date("2026-11-25")).success).toBe(true);
    expect(dueRefSchema.safeParse(word("end_of_week")).success).toBe(true);
    expect(dueRefSchema.safeParse(word("soon")).success).toBe(false);
    expect(dueRefSchema.safeParse({ kind: "date", date: "25.11.2026" }).success).toBe(false);
    expect(dueRefSchema.safeParse({ kind: "word", word: "friday", extra: 1 }).success).toBe(false);
  });
});
