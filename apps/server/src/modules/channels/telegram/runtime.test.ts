import { describe, expect, test } from "bun:test";

import { SoftError } from "../../../platform/errors";

import { cacheOnSuccess, withTimeout } from "./runtime";

describe("cacheOnSuccess", () => {
  test("two calls make one load and both get the value", async () => {
    let loads = 0;
    const get = cacheOnSuccess(async () => {
      loads += 1;
      return "bot";
    });
    expect(await Promise.all([get(), get()])).toEqual(["bot", "bot"]);
    expect(await get()).toBe("bot");
    expect(loads).toBe(1);
  });

  test("a rejected load is dropped: the next call loads again", async () => {
    let loads = 0;
    const get = cacheOnSuccess(async () => {
      loads += 1;
      if (loads === 1) throw new Error("down");
      return "bot";
    });
    await expect(get()).rejects.toThrow("down");
    expect(await get()).toBe("bot");
    expect(loads).toBe(2);
  });
});

describe("withTimeout", () => {
  test("a promise that never settles rejects with a SoftError", async () => {
    const start = Date.now();
    const error = await withTimeout(new Promise<string>((): void => undefined), 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SoftError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("a settled promise passes through", async () => {
    expect(await withTimeout(Promise.resolve("ok"), 50)).toBe("ok");
  });
});
