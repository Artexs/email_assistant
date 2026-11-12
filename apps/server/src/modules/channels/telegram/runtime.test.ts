import { describe, expect, test } from "bun:test";

import { SoftError } from "../../../platform/errors";

import { cacheOnSuccess, createTelegramRuntime, withTimeout, type TelegramRuntimeDeps } from "./runtime";

function runtimeFor(apiRoot: string) {
  // `botUsername` never touches the database or the hooks.
  const deps = {
    db: {},
    token: "123:abc",
    now: () => new Date(),
    startedAt: new Date(),
    operatorContact: null,
    apiRoot,
  } as unknown as TelegramRuntimeDeps;
  return createTelegramRuntime(deps);
}

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

describe("botUsername", () => {
  test("a getMe that hangs is requested once for several calls", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requests += 1;
        return new Promise<Response>((): void => undefined);
      },
    });
    try {
      const runtime = runtimeFor(`http://127.0.0.1:${server.port}`);
      const results = await Promise.allSettled([runtime.botUsername(), runtime.botUsername()]);
      expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
      await expect(runtime.botUsername()).rejects.toBeInstanceOf(SoftError);
      expect(requests).toBe(1);
    } finally {
      await server.stop(true);
    }
  }, 15_000);

  test("a failed getMe is dropped and a later success is cached", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requests += 1;
        if (requests === 1)
          return Response.json({ ok: false, error_code: 502, description: "bad gateway" }, { status: 502 });
        return Response.json({ ok: true, result: { id: 1, is_bot: true, first_name: "Bot", username: "ea_test_bot" } });
      },
    });
    try {
      const runtime = runtimeFor(`http://127.0.0.1:${server.port}`);
      await expect(runtime.botUsername()).rejects.toBeDefined();
      expect(await runtime.botUsername()).toBe("ea_test_bot");
      expect(await runtime.botUsername()).toBe("ea_test_bot");
      expect(requests).toBe(2);
    } finally {
      await server.stop(true);
    }
  });
});
