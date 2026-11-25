import { describe, expect, test } from "bun:test";

import {
  clickPath,
  fetchRule,
  installWorker,
  notificationOf,
  OFFLINE_PATH,
  staleCaches,
  type WorkerScope,
  type WorkerWindow,
} from "./service-worker";

const ORIGIN = "https://panel.example";
const SHELL = { assets: ["/_astro/a.css"], version: "v2-abcd1234" };
const SHELL_CACHE = `ea-shell-${SHELL.version}`;
const req = (path: string, init: { method?: string; mode?: string } = {}) => ({
  method: init.method ?? "GET",
  url: `${ORIGIN}${path}`,
  mode: init.mode ?? "cors",
});

describe("fetchRule", () => {
  test("1. an /api request is never handled, with any method, mode or sub-path; a hashed file is cache first; a page load goes to the network", () => {
    for (const path of ["/api/me", "/api/me/push", "/api", "/api/", "/api/openapi.json", "/api/emails?x=1"]) {
      for (const mode of ["cors", "navigate", "same-origin", "no-cors"]) {
        expect([path, mode, fetchRule(req(path, { mode }), ORIGIN)]).toEqual([path, mode, "not-handled"]);
      }
    }
    expect(fetchRule(req("/_astro/a.js"), ORIGIN)).toBe("cache-first");
    expect(fetchRule(req("/_astro/chunk.css", { mode: "no-cors" }), ORIGIN)).toBe("cache-first");
    expect(fetchRule(req("/activity", { mode: "navigate" }), ORIGIN)).toBe("network-with-offline-page");
    expect(fetchRule(req("/approvals?id=x", { mode: "navigate" }), ORIGIN)).toBe("network-with-offline-page");
  });

  test("anything else is not handled: a POST, another origin, a page asset that is not hashed, a bad URL", () => {
    expect(fetchRule(req("/_astro/a.js", { method: "POST" }), ORIGIN)).toBe("not-handled");
    expect(fetchRule({ method: "GET", url: "https://other.example/_astro/a.js", mode: "cors" }, ORIGIN)).toBe(
      "not-handled"
    );
    expect(fetchRule({ method: "GET", url: "https://other.example/x", mode: "navigate" }, ORIGIN)).toBe("not-handled");
    expect(fetchRule(req("/favicon.png"), ORIGIN)).toBe("not-handled");
    expect(fetchRule(req("/manifest.webmanifest"), ORIGIN)).toBe("not-handled");
    expect(fetchRule({ method: "GET", url: "not a url", mode: "navigate" }, ORIGIN)).toBe("not-handled");
  });
});

describe("staleCaches", () => {
  test("only caches of this app from another version go; the current one and a cache of another owner stay", () => {
    expect(
      staleCaches(["ea-shell-v1", SHELL_CACHE, "ea-shell-v2-00000000", "other-cache", "workbox-1"], SHELL_CACHE)
    ).toEqual(["ea-shell-v1", "ea-shell-v2-00000000"]);
    expect(staleCaches([SHELL_CACHE], SHELL_CACHE)).toEqual([]);
  });
});

describe("notificationOf", () => {
  const urgent = { v: 1, id: "r1", kind: "urgent", count: 2, itemId: null, lang: "en" };

  test("2. a valid payload gives the title and body of pushTexts, the tag and the path of its kind", () => {
    expect(notificationOf(urgent)).toEqual({
      title: "Urgent mail",
      options: { body: "2 urgent mails", tag: "r1", data: { path: "/activity?category=urgent" } },
    });
    const item = "3f1c2a52-0b6e-4c1a-9d0e-5a7b8c9d0e1f";
    expect(notificationOf({ ...urgent, kind: "approval", count: 3, itemId: item, lang: "pl" })).toEqual({
      title: "Szkic do akceptacji",
      options: { body: "3 szkice czekają na Ciebie", tag: "r1", data: { path: `/approvals?id=${item}` } },
    });
  });

  test("a payload with an extra key, a bad count, a wrong version or no object shows nothing", () => {
    expect(notificationOf({ ...urgent, subject: "Salary" })).toBeNull();
    expect(notificationOf({ ...urgent, count: -1 })).toBeNull();
    expect(notificationOf({ ...urgent, v: 2 })).toBeNull();
    expect(notificationOf({ ...urgent, kind: "digest" })).toBeNull();
    expect(notificationOf(null)).toBeNull();
    expect(notificationOf("urgent")).toBeNull();
    expect(notificationOf([urgent])).toBeNull();
  });
});

describe("clickPath", () => {
  test("a path on the panel passes; anything else falls back to Activity", () => {
    expect(clickPath({ path: "/approvals?id=x" })).toBe("/approvals?id=x");
    for (const data of [
      null,
      undefined,
      "x",
      {},
      { path: 5 },
      { path: "approvals" },
      { path: "//evil.example" },
      { path: "https://evil.example/" },
      { path: "/\\evil" },
    ]) {
      expect(clickPath(data)).toBe("/activity");
    }
  });
});

// A same-origin answer of a real `fetch` has the type `basic`; the `Response` constructor gives `default`.
function basic(body: string, status = 200): Response {
  const response = new Response(body, { status });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

// A scope that records its listeners and holds a fake cache. `network` is what `fetch` does.
function harness() {
  const listeners = new Map<string, (event: never) => void>();
  const store = new Map<string, Response>();
  const log = {
    fetched: [] as string[],
    cacheNames: [SHELL_CACHE],
    deleted: [] as string[],
    notices: [] as unknown[],
    opened: [] as string[],
    cacheOpened: [] as string[],
  };
  const windows: (WorkerWindow & { focused: boolean; navigated: string[] })[] = [];
  let network: (request: Request) => Promise<Response> = async () => basic("net");
  const keyOf = (r: Request | string) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
  const cache = {
    addAll: async (paths: readonly string[]) => {
      for (const path of paths) store.set(keyOf(path), await network(new Request(keyOf(path))));
    },
    put: async (r: Request, response: Response) => void store.set(keyOf(r), response),
    match: async (r: Request | string) => store.get(keyOf(r))?.clone(),
  };
  const scope = {
    location: { origin: ORIGIN },
    caches: {
      open: async (name: string) => {
        log.cacheOpened.push(name);
        return cache;
      },
      keys: async () => log.cacheNames,
      delete: async (name: string) => {
        log.deleted.push(name);
        return true;
      },
      match: async (r: Request | string) => store.get(keyOf(r))?.clone(),
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => void log.opened.push(url),
      claim: async () => undefined,
    },
    registration: {
      showNotification: async (title: string, options: unknown) => void log.notices.push({ title, options }),
    },
    addEventListener: (type: string, listener: (event: never) => void) => void listeners.set(type, listener),
  } as unknown as WorkerScope;
  // The worker calls the global fetch: the harness replaces it for the run of one test.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Request) => {
    log.fetched.push(input.url);
    return network(input);
  }) as unknown as typeof fetch;
  installWorker(scope, SHELL);
  return {
    log,
    store,
    windows,
    setNetwork: (fn: typeof network) => void (network = fn),
    restore: () => void (globalThis.fetch = realFetch),
    fire: (type: string, event: object) => listeners.get(type)?.(event as never),
    fetchEvent(path: string, mode = "cors", method = "GET") {
      const calls: Promise<Response>[] = [];
      const request = new Request(`${ORIGIN}${path}`, { method });
      Object.defineProperty(request, "mode", { value: mode });
      listeners.get("fetch")?.({
        request,
        respondWith: (r: Promise<Response>) => void calls.push(Promise.resolve(r)),
      } as never);
      return calls;
    },
  };
}

async function withHarness(run: (h: ReturnType<typeof harness>) => Promise<void>): Promise<void> {
  const h = harness();
  try {
    await run(h);
  } finally {
    h.restore();
  }
}

describe("the worker", () => {
  test("1b. a fetch of /api never calls respondWith and never touches the network or the cache; a page is never stored", async () => {
    await withHarness(async (h) => {
      for (const [path, mode] of [
        ["/api/me", "cors"],
        ["/api/me/push", "same-origin"],
        ["/api/emails", "navigate"],
      ] as const) {
        expect(h.fetchEvent(path, mode)).toHaveLength(0);
      }
      expect(h.log.fetched).toEqual([]);
      expect(h.store.size).toBe(0);

      const page = h.fetchEvent("/activity", "navigate");
      expect(page).toHaveLength(1);
      expect(await (await page[0])?.text()).toBe("net");
      expect(h.log.fetched).toEqual([`${ORIGIN}/activity`]);
      expect(h.store.size).toBe(0);
    });
  });

  test("a page goes to the network; only a network error gives the offline page; a 500 answer passes through", async () => {
    await withHarness(async (h) => {
      h.store.set(`${ORIGIN}${OFFLINE_PATH}`, new Response("offline page"));
      h.setNetwork(async () => new Response("boom", { status: 500 }));
      expect(await (await h.fetchEvent("/activity", "navigate")[0])?.text()).toBe("boom");
      h.setNetwork(async () => {
        throw new TypeError("network down");
      });
      expect(await (await h.fetchEvent("/activity", "navigate")[0])?.text()).toBe("offline page");
    });
  });

  test("a hashed file is fetched once and then served from the cache; an error answer is not stored", async () => {
    await withHarness(async (h) => {
      const first = await h.fetchEvent("/_astro/a.js")[0];
      expect(first).toBeDefined();
      expect(h.log.fetched).toEqual([`${ORIGIN}/_astro/a.js`]);
      expect(h.store.size).toBe(1);
      const again = await h.fetchEvent("/_astro/a.js")[0];
      expect(await again?.text()).toBe("net");
      expect(h.log.fetched).toHaveLength(1);

      h.setNetwork(async () => basic("missing", 404));
      await h.fetchEvent("/_astro/b.js")[0];
      expect(h.store.size).toBe(1);
    });
  });

  test("install stores the offline page and its files in the cache of the build version; activate deletes the caches of other versions only", async () => {
    await withHarness(async (h) => {
      const work: Promise<unknown>[] = [];
      h.fire("install", { waitUntil: (p: Promise<unknown>) => work.push(p) });
      await Promise.all(work);
      expect(h.log.cacheOpened).toEqual([SHELL_CACHE]);
      expect([...h.store.keys()]).toEqual([`${ORIGIN}${OFFLINE_PATH}`, `${ORIGIN}/_astro/a.css`]);

      h.log.cacheNames.push("ea-shell-v1", "other");
      const activation: Promise<unknown>[] = [];
      h.fire("activate", { waitUntil: (p: Promise<unknown>) => activation.push(p) });
      await Promise.all(activation);
      expect(h.log.deleted).toEqual(["ea-shell-v1"]);
    });
  });

  test("2b. a push shows the notification of a valid payload and nothing for a bad one or bad JSON", async () => {
    await withHarness(async (h) => {
      const waits: Promise<unknown>[] = [];
      const push = (data: unknown) =>
        h.fire("push", { waitUntil: (p: Promise<unknown>) => waits.push(p), data: { json: () => data } });
      push({ v: 1, id: "r1", kind: "urgent", count: 2, itemId: null, lang: "en" });
      push({ v: 1, id: "r2", kind: "urgent", count: 2, itemId: null, lang: "en", subject: "Salary" });
      h.fire("push", {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        data: {
          json: () => {
            throw new SyntaxError("bad json");
          },
        },
      });
      h.fire("push", { waitUntil: (p: Promise<unknown>) => waits.push(p), data: null });
      await Promise.all(waits);
      expect(h.log.notices).toEqual([
        {
          title: "Urgent mail",
          options: { body: "2 urgent mails", tag: "r1", data: { path: "/activity?category=urgent" } },
        },
      ]);
    });
  });

  test("a tap focuses an open panel window and navigates it; with no window it opens the path; a bad path opens Activity", async () => {
    await withHarness(async (h) => {
      const waits: Promise<unknown>[] = [];
      const tap = (data: unknown) => {
        let closed = false;
        h.fire("notificationclick", {
          waitUntil: (p: Promise<unknown>) => waits.push(p),
          notification: { data, close: () => void (closed = true) },
        });
        return () => closed;
      };
      const closed = tap({ path: "/approvals" });
      await Promise.all(waits);
      expect(closed()).toBe(true);
      expect(h.log.opened).toEqual(["/approvals"]);

      const win = {
        url: `${ORIGIN}/mailboxes`,
        focused: false,
        navigated: [] as string[],
        focus: async () => void (win.focused = true),
        navigate: async (u: string) => void win.navigated.push(u),
      };
      h.windows.push(win);
      tap({ path: "/activity?category=urgent" });
      await Promise.all(waits);
      expect(win.focused).toBe(true);
      expect(win.navigated).toEqual(["/activity?category=urgent"]);
      expect(h.log.opened).toEqual(["/approvals"]);

      tap({ path: "https://evil.example/" });
      await Promise.all(waits);
      expect(win.navigated).toEqual(["/activity?category=urgent", "/activity"]);
    });
  });
});
