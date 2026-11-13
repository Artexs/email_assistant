import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { createHeartbeat } from "./heartbeat";

type Handler = () => Response | Promise<Response>;

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});

function startServer(handler: Handler): { url: string; hits: () => number } {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      hits += 1;
      return handler();
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}/ping`, hits: () => hits };
}

const dbUp = async () => true;
const dbDown = async () => false;

describe("heartbeat", () => {
  test("pings once when the DB is up", async () => {
    const server = startServer(() => new Response("OK"));
    await createHeartbeat({ url: server.url, checkDb: dbUp }).tick();
    expect(server.hits()).toBe(1);
  });

  test("does not ping when the DB is down", async () => {
    const server = startServer(() => new Response("OK"));
    await createHeartbeat({ url: server.url, checkDb: dbDown }).tick();
    expect(server.hits()).toBe(0);
  });

  test("does not throw when the server answers 500", async () => {
    const server = startServer(() => new Response("no", { status: 500 }));
    await createHeartbeat({ url: server.url, checkDb: dbUp }).tick();
    expect(server.hits()).toBe(1);
  });

  test("a failed fetch logs the error name only, never the message or the URL", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      const failing = (async () => {
        throw new TypeError("MARKER-URL https://hc.test/secret");
      }) as unknown as typeof fetch;
      await createHeartbeat({ url: "https://hc.test/secret", checkDb: dbUp, fetch: failing }).tick();
      const lines = errorSpy.mock.calls.map((call) => call.join(" "));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("heartbeat_ping_failed");
      expect(lines[0]).toContain("error=TypeError");
      expect(lines[0]).not.toContain("MARKER-URL");
      expect(lines[0]).not.toContain("hc.test");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("does nothing without a URL", async () => {
    let checked = false;
    await createHeartbeat({
      url: undefined,
      checkDb: async () => {
        checked = true;
        return true;
      },
    }).tick();
    expect(checked).toBe(false);
  });

  test("does not throw when checkDb throws", async () => {
    await createHeartbeat({
      url: "http://127.0.0.1:1/ping",
      checkDb: async () => {
        throw new Error("db boom");
      },
    }).tick();
  });

  test("gives up on a server that never answers", async () => {
    const server = startServer(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    await createHeartbeat({ url: server.url, checkDb: dbUp, timeoutMs: 100 }).tick();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
