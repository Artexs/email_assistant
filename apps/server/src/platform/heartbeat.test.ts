import { afterEach, describe, expect, test } from "bun:test";

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
