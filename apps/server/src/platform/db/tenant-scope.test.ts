import { describe, expect, test } from "bun:test";

import { currentTenantScope, withoutTenantScope, withTenantScope } from "./tenant-scope";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("tenant scope", () => {
  test("outside any scope the scope is null", () => {
    expect(currentTenantScope()).toBeNull();
  });

  test("withTenantScope sets the scope for its callback only", () => {
    expect(withTenantScope(A, () => currentTenantScope())).toBe(A);
    expect(currentTenantScope()).toBeNull();
  });

  test("withoutTenantScope clears an outer scope and the outer scope returns", () => {
    const inner = withTenantScope(A, () => {
      const cleared = withoutTenantScope(() => currentTenantScope());
      return { cleared, after: currentTenantScope() };
    });
    expect(inner).toEqual({ cleared: null, after: A });
  });

  test("the scope survives awaits and timers", async () => {
    const seen = await withTenantScope(A, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentTenantScope();
    });
    expect(seen).toBe(A);
  });

  test("an empty organization id throws", () => {
    expect(() => withTenantScope("", () => 1)).toThrow("withTenantScope needs an organization id");
  });

  test("ten parallel calls each keep their own scope", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withTenantScope(i % 2 === 0 ? A : B, async () => {
          await new Promise((resolve) => setTimeout(resolve, i % 3));
          return currentTenantScope();
        })
      )
    );
    expect(results).toEqual(Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? A : B)));
  });

  test("a nested scope wins inside and the outer scope returns", () => {
    const result = withTenantScope(A, () => {
      const inside = withTenantScope(B, () => currentTenantScope());
      return { inside, after: currentTenantScope() };
    });
    expect(result).toEqual({ inside: B, after: A });
  });
});
