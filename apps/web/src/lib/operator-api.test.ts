/// <reference types="bun" />
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { en, type TextKey } from "../i18n/en";
import { setLocaleForTest } from "../i18n";

import { ApiError } from "./api";
import { changeFlag, changePlan, planBodyOf, planChangeText, writeErrorKey } from "./operator-api";

const ORG = "0b1c2d3e-0000-4000-8000-000000000001";

const planResult = {
  result: "changed",
  plan: "suspended",
  trialEndsAt: null,
  maxMailboxes: 3,
  resumedAt: null,
  cancelledMessages: 0,
  expiredSends: 0,
} as const;

let fetchSpy: ReturnType<typeof spyOn> | undefined;

function mockFetch(body: unknown) {
  const calls: { path: string; init?: RequestInit }[] = [];
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(((path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return Promise.resolve(Response.json(body));
  }) as unknown as typeof fetch);
  return calls;
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  setLocaleForTest("en");
});

describe("changePlan and changeFlag", () => {
  test("changePlan sends POST /plan with the JSON body and parses the result", async () => {
    const calls = mockFetch(planResult);
    const result = await changePlan(ORG, { plan: "suspended" });
    expect(calls[0]?.path).toBe(`/api/operator/orgs/${ORG}/plan`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"plan":"suspended"}');
    expect(result).toEqual(planResult);
  });

  test("changeFlag sends POST /flags with flag and enabled", async () => {
    const calls = mockFetch({ result: "changed", flag: "stats_page", enabled: true });
    const result = await changeFlag(ORG, { flag: "stats_page", enabled: true });
    expect(calls[0]?.path).toBe(`/api/operator/orgs/${ORG}/flags`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe('{"flag":"stats_page","enabled":true}');
    expect(result).toEqual({ result: "changed", flag: "stats_page", enabled: true });
  });
});

const mapped: [string, TextKey][] = [
  ["trial_days_needed", "op_err_trial_days_needed"],
  ["trial_days_without_trial", "op_err_trial_days_without_trial"],
  ["nothing_to_change", "op_err_nothing_to_change"],
  ["trial_days_range", "op_err_trial_days_range"],
  ["max_mailboxes_range", "op_err_max_mailboxes_range"],
  ["unknown_flag", "op_err_unknown_flag"],
  ["not_found", "op_not_found"],
  ["validation", "op_err_validation"],
  ["org_suspended", "error_generic"],
  ["bad_origin", "error_generic"],
  ["toString", "error_generic"],
];

describe("writeErrorKey", () => {
  test.each(mapped)("code %s gives %s", (code, key) => {
    expect(writeErrorKey(new ApiError(400, code))).toBe(key);
  });

  test("an error that is not an ApiError gives error_generic", () => {
    expect(writeErrorKey(new Error("x"))).toBe("error_generic");
  });

  test("every returned key exists in en", () => {
    for (const [, key] of mapped) expect(Object.hasOwn(en, key)).toBe(true);
  });
});

describe("planChangeText", () => {
  test("unchanged", () => {
    expect(planChangeText({ ...planResult, result: "unchanged" })).toBe(en.op_plan_unchanged);
  });

  test("changed with counts adds the cancelled and expired parts", () => {
    const text = planChangeText({ ...planResult, cancelledMessages: 2, expiredSends: 1 });
    expect(text).toBe(
      `${en.op_plan_changed.replace("{plan}", en.op_plan_suspended)} ${en.op_plan_cancelled.replace("{count}", "2")} ${en.op_plan_expired.replace("{count}", "1")}`
    );
  });

  test("changed with zeros has no count part", () => {
    expect(planChangeText(planResult)).toBe(en.op_plan_changed.replace("{plan}", en.op_plan_suspended));
  });

  test("every key it uses exists in en", () => {
    for (const key of ["op_plan_unchanged", "op_plan_changed", "op_plan_cancelled", "op_plan_expired"])
      expect(Object.hasOwn(en, key)).toBe(true);
  });
});

describe("planBodyOf", () => {
  const current = { plan: "active", maxMailboxes: 3 } as const;

  test("returns only the fields that differ", () => {
    expect(planBodyOf(current, { plan: "suspended", trialDays: "", maxMailboxes: "3" })).toEqual({ plan: "suspended" });
    expect(planBodyOf(current, { plan: "active", trialDays: "", maxMailboxes: "5" })).toEqual({ maxMailboxes: 5 });
  });

  test("returns null when nothing differs", () => {
    expect(planBodyOf(current, { plan: "active", trialDays: "", maxMailboxes: "3" })).toBeNull();
    expect(planBodyOf(current, { plan: "active", trialDays: "", maxMailboxes: "" })).toBeNull();
  });

  test("trial days count only for the plan trial", () => {
    expect(planBodyOf(current, { plan: "trial", trialDays: "14", maxMailboxes: "3" })).toEqual({
      plan: "trial",
      trialDays: 14,
    });
    expect(planBodyOf(current, { plan: "suspended", trialDays: "14", maxMailboxes: "3" })).toEqual({
      plan: "suspended",
    });
  });
});
