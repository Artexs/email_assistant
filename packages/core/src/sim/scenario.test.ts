import { describe, expect, test } from "bun:test";

import { miniScenario } from "./fixtures";
import { scenarioSchema, validateScenario, type Scenario, type ScenarioIssue } from "./scenario";

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

describe("validateScenario", () => {
  test("miniScenario passes the schema and has no issue", () => {
    expect(scenarioSchema.safeParse(miniScenario).success).toBe(true);
    expect(validateScenario(miniScenario)).toEqual([]);
  });

  test("the executive voice and signature are optional and default to none", () => {
    // An older scenario file has neither field.
    const older: Record<string, unknown> = { ...miniScenario.executive };
    delete older.voice;
    delete older.signature;
    const parsed = scenarioSchema.parse({ ...miniScenario, executive: older });
    expect(parsed.executive.voice).toBe("");
    expect(parsed.executive.signature).toBe("");
    expect(scenarioSchema.parse(miniScenario).executive.signature).toBe("Pozdrawiam, Szef");
    expect(
      scenarioSchema.safeParse({ ...miniScenario, executive: { ...miniScenario.executive, tone: "x" } }).success
    ).toBe(false);
  });

  const clone = () => structuredClone(miniScenario);
  const withCalendar = (bankStart: string, weekStart: string, deadlines: string[]): Scenario => {
    const s = clone();
    s.calendar = { bankStart, weekStart };
    s.urgency.profile.deadlines = deadlines.map((due, n) => ({ label: `Deadline ${n}`, due }));
    return s;
  };
  const withGroupsRemoved = (...groups: string[]): Scenario => {
    const s = clone();
    s.personas = s.personas.filter((persona) => !groups.includes(persona.group));
    return s;
  };

  test.each<[string, () => Scenario, ScenarioIssue[]]>([
    [
      "a persona key equal to the executive key",
      () => {
        const s = clone();
        at(s.personas, 7).key = "szef";
        return s;
      },
      [{ code: "duplicate_key", detail: "persona: szef" }],
    ],
    [
      "a persona key used twice",
      () => {
        const s = clone();
        at(s.personas, 7).key = "prezes";
        return s;
      },
      [{ code: "duplicate_key", detail: "persona: prezes" }],
    ],
    [
      "two personas with the same address",
      () => {
        const s = clone();
        at(s.personas, 1).address = at(s.personas, 0).address;
        return s;
      },
      [{ code: "duplicate_address", detail: "persona: kasia shares an address with prezes" }],
    ],
    [
      "a persona with the executive address",
      () => {
        const s = clone();
        at(s.personas, 1).address = "szef@mini.test";
        return s;
      },
      [{ code: "duplicate_address", detail: "persona: kasia shares an address with szef" }],
    ],
    [
      "a persona address on a real host",
      () => {
        const s = clone();
        at(s.personas, 4).address = "x@gmail.com";
        return s;
      },
      [{ code: "address_not_reserved", detail: "persona: client-a" }],
    ],
    [
      "an executive address outside the company domain",
      () => {
        const s = clone();
        s.executive.address = "szef@other.test";
        return s;
      },
      [{ code: "executive_not_company", detail: "executive: szef" }],
    ],
    [
      "a delegate that is no persona",
      () => {
        const s = clone();
        at(s.delegates, 0).persona = "nobody";
        return s;
      },
      [{ code: "unknown_persona", detail: "delegates: nobody" }],
    ],
    [
      "a delegate in a client persona",
      () => {
        const s = clone();
        at(s.delegates, 0).persona = "client-a";
        return s;
      },
      [{ code: "delegate_not_delegate_group", detail: "delegates: client-a" }],
    ],
    [
      "a VIP that is no persona",
      () => {
        const s = clone();
        s.urgency.vip = ["prezes", "nobody"];
        return s;
      },
      [{ code: "vip_unknown", detail: "urgency.vip: nobody" }],
    ],
    [
      "no phishing persona",
      () => withGroupsRemoved("phishing"),
      [{ code: "missing_group", detail: "group: phishing" }],
    ],
    [
      "no spammer and no phishing persona",
      () => withGroupsRemoved("spammer", "phishing"),
      [
        { code: "missing_group", detail: "group: spammer" },
        { code: "missing_group", detail: "group: phishing" },
      ],
    ],
    [
      "a Tuesday weekStart",
      () => withCalendar("2026-11-02", "2026-11-17", ["2026-11-20"]),
      [{ code: "not_monday", detail: "calendar.weekStart" }],
    ],
    [
      "a Tuesday bankStart",
      () => withCalendar("2026-11-03", "2026-11-16", ["2026-11-20"]),
      [{ code: "not_monday", detail: "calendar.bankStart" }],
    ],
    [
      "a deadline a day before the bank window",
      () => withCalendar("2026-11-02", "2026-11-16", ["2026-10-25", "2026-10-26"]),
      [{ code: "deadline_out_of_range", detail: "urgency.profile.deadlines[0]" }],
    ],
    [
      "a deadline a day after the week window",
      () => withCalendar("2026-11-02", "2026-11-16", ["2026-12-07", "2026-12-08"]),
      [{ code: "deadline_out_of_range", detail: "urgency.profile.deadlines[1]" }],
    ],
    [
      "a topic that names no persona",
      () => {
        const s = clone();
        at(s.topics, 1).personas = ["marek", "nobody"];
        return s;
      },
      [{ code: "topic_persona_unknown", detail: "topics: oferty names nobody" }],
    ],
    [
      "a week with the spring DST change of Europe/Warsaw",
      () => withCalendar("2027-03-08", "2027-03-22", ["2027-03-20"]),
      [{ code: "dst_in_week", detail: "calendar.weekStart" }],
    ],
    [
      "a week with the autumn DST change of Europe/Warsaw",
      () => withCalendar("2026-10-05", "2026-10-19", ["2026-10-20"]),
      [{ code: "dst_in_week", detail: "calendar.weekStart" }],
    ],
  ])("one rule broken: %s gives one exact issue list", (_name, build, expected) => {
    expect(validateScenario(build())).toEqual(expected);
  });

  test.each([
    ["the week before the spring DST change", withCalendar("2027-03-01", "2027-03-15", ["2027-03-20"])],
    ["the week after the spring DST change", withCalendar("2027-03-15", "2027-03-29", ["2027-03-20"])],
    ["the week after the autumn DST change", withCalendar("2026-10-12", "2026-10-26", ["2026-10-20"])],
    ["deadlines on both edges of the window", withCalendar("2026-11-02", "2026-11-16", ["2026-10-26", "2026-12-07"])],
  ])("%s has no issue", (_name, scenario) => {
    expect(validateScenario(scenario)).toEqual([]);
  });

  test("several broken rules list their issues in the order of the checks", () => {
    const s = clone();
    s.urgency.vip = ["nobody"];
    at(s.topics, 0).personas = ["nobody"];
    at(s.delegates, 0).persona = "nobody";
    expect(validateScenario(s)).toEqual([
      { code: "unknown_persona", detail: "delegates: nobody" },
      { code: "vip_unknown", detail: "urgency.vip: nobody" },
      { code: "topic_persona_unknown", detail: "topics: faktury names nobody" },
    ]);
  });

  test("a duplicate address detail names keys only", () => {
    const s = clone();
    at(s.personas, 1).address = at(s.personas, 0).address;
    const [issue] = validateScenario(s);
    for (const persona of s.personas) {
      expect(issue?.detail).not.toContain(persona.displayName);
      expect(issue?.detail).not.toContain(persona.voice);
    }
  });
});
