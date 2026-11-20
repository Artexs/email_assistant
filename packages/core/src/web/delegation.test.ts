import { describe, expect, test } from "bun:test";

import { DELEGATE_NAME_RAW_MAX, delegatePatchBodySchema } from "./delegation";

function issues(body: unknown): { path: PropertyKey[]; message: string }[] | null {
  const result = delegatePatchBodySchema.safeParse(body);
  return result.success ? null : result.error.issues.map(({ path, message }) => ({ path, message }));
}

describe("delegatePatchBodySchema", () => {
  test("an empty body is refused with one issue that names the three fields", () => {
    expect(issues({})).toEqual([{ path: [], message: "name, tags or active is required" }]);
  });

  test.each([
    ["only active false", { active: false }],
    ["only active true", { active: true }],
    ["only a name", { name: "Ala" }],
    ["only an empty tag list", { tags: [] }],
  ])("%s parses", (_name, body) => {
    expect(delegatePatchBodySchema.safeParse(body).success).toBe(true);
  });

  test("a name of the raw maximum parses and one more character is refused", () => {
    expect(delegatePatchBodySchema.safeParse({ name: "a".repeat(DELEGATE_NAME_RAW_MAX) }).success).toBe(true);
    expect(issues({ name: "a".repeat(DELEGATE_NAME_RAW_MAX + 1) })).toEqual([
      { path: ["name"], message: `Too big: expected string to have <=${DELEGATE_NAME_RAW_MAX} characters` },
    ]);
  });
});
