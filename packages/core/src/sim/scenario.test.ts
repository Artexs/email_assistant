import { describe, expect, test } from "bun:test";

import { miniScenario } from "./fixtures";
import { scenarioSchema, validateScenario, type Scenario, type ScenarioIssueCode } from "./scenario";

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

function codes(s: Scenario): ScenarioIssueCode[] {
  return validateScenario(s).map((issue) => issue.code);
}

describe("validateScenario", () => {
  test("miniScenario passes the schema and has no issue", () => {
    expect(scenarioSchema.safeParse(miniScenario).success).toBe(true);
    expect(validateScenario(miniScenario)).toEqual([]);
  });

  test("two personas with the same address give one duplicate_address naming keys only", () => {
    const s = structuredClone(miniScenario);
    at(s.personas, 1).address = at(s.personas, 0).address;
    const issues = validateScenario(s);
    expect(issues.map((issue) => issue.code)).toEqual(["duplicate_address"]);
    expect(at(issues, 0).detail).toContain("kasia");
    expect(at(issues, 0).detail).toContain("prezes");
    for (const persona of s.personas) {
      expect(at(issues, 0).detail).not.toContain(persona.displayName);
      expect(at(issues, 0).detail).not.toContain(persona.voice);
    }
  });

  test("a persona address on a real host is address_not_reserved", () => {
    const s = structuredClone(miniScenario);
    at(s.personas, 4).address = "x@gmail.com";
    expect(codes(s)).toEqual(["address_not_reserved"]);
  });

  test("an executive address outside the company domain is executive_not_company", () => {
    const s = structuredClone(miniScenario);
    s.executive.address = "szef@other.test";
    expect(codes(s)).toEqual(["executive_not_company"]);
  });

  test("a delegate that points to a client persona is delegate_not_delegate_group", () => {
    const s = structuredClone(miniScenario);
    at(s.delegates, 0).persona = "client-a";
    expect(codes(s)).toEqual(["delegate_not_delegate_group"]);
  });

  test("removing the only phishing persona gives missing_group naming the group", () => {
    const s = structuredClone(miniScenario);
    s.personas = s.personas.filter((persona) => persona.group !== "phishing");
    const issues = validateScenario(s);
    expect(issues.map((issue) => issue.code)).toEqual(["missing_group"]);
    expect(at(issues, 0).detail).toContain("phishing");
  });

  test("a Tuesday weekStart is not_monday", () => {
    const s = structuredClone(miniScenario);
    s.calendar.weekStart = "2026-11-17";
    expect(codes(s)).toEqual(["not_monday"]);
  });

  test("a deadline far after the week is deadline_out_of_range", () => {
    const s = structuredClone(miniScenario);
    at(s.urgency.profile.deadlines, 0).due = "2027-06-01";
    expect(codes(s)).toEqual(["deadline_out_of_range"]);
  });

  test("a week with the DST change of Europe/Warsaw is dst_in_week", () => {
    const s = structuredClone(miniScenario);
    s.calendar.weekStart = "2027-03-22";
    expect(codes(s)).toContain("dst_in_week");
    s.calendar.weekStart = "2026-10-19";
    expect(codes(s)).toContain("dst_in_week");
  });

  test("unknown keys in vip, topics and delegates are reported", () => {
    const s = structuredClone(miniScenario);
    s.urgency.vip = ["nobody"];
    at(s.topics, 0).personas = ["nobody"];
    at(s.delegates, 0).persona = "nobody";
    expect(codes(s).sort()).toEqual(["topic_persona_unknown", "unknown_persona", "vip_unknown"]);
  });

  test("a duplicate persona key is duplicate_key", () => {
    const s = structuredClone(miniScenario);
    at(s.personas, 1).key = "prezes";
    expect(codes(s)).toContain("duplicate_key");
  });
});
