import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Bot } from "grammy";

import { BOT_COMMANDS, startPolling } from "./polling";

const TOKEN = "123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa";

type Answer = (body: Record<string, unknown>, call: number) => Promise<Response> | Response;
type FakeServer = ReturnType<typeof Bun.serve>;

const servers: FakeServer[] = [];
let infoSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

const ok = (result: unknown): Response => Response.json({ ok: true, result });
const fail = (code: number): Response =>
  Response.json({ ok: false, error_code: code, description: `fake ${code}` }, { status: code });
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const me = { id: 7, is_bot: true, first_name: "b", username: "probe_bot", can_join_groups: false };

interface Fake {
  bot: Bot;
  calls: { method: string; body: Record<string, unknown> }[];
}

function startFake(overrides: Record<string, Answer> = {}): Fake {
  const calls: Fake["calls"] = [];
  const counts = new Map<string, number>();
  const defaults: Record<string, Answer> = {
    getMe: () => ok(me),
    deleteWebhook: () => ok(true),
    setMyCommands: () => ok(true),
    getUpdates: async () => {
      await wait(50);
      return ok([]);
    },
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const method = new URL(req.url).pathname.split("/").pop() ?? "";
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      calls.push({ method, body });
      const call = (counts.get(method) ?? 0) + 1;
      counts.set(method, call);
      return (overrides[method] ?? defaults[method] ?? (() => ok(true)))(body, call);
    },
  });
  servers.push(server);
  const bot = new Bot(TOKEN, { client: { apiRoot: `http://127.0.0.1:${server.port}` } });
  bot.catch(() => undefined);
  return { bot, calls };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) {
    await wait(10);
  }
  expect(check()).toBe(true);
}

const lines = (spy: ReturnType<typeof spyOn>): string[] => spy.mock.calls.map((args: unknown[]) => args.join(" "));

beforeEach(() => {
  infoSpy = spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = spyOn(console, "error").mockImplementation(() => undefined);
  errorSpy = warnSpy;
});

afterEach(() => {
  for (const server of servers.splice(0)) {
    void server.stop(true);
  }
  infoSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("startPolling", () => {
  test("polls, sets the commands and stops cleanly", async () => {
    const { bot, calls } = startFake();
    const polling = startPolling(bot);
    await until(() => calls.some((c) => c.method === "setMyCommands"));
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 1);

    await polling.stop();
    await polling.done;

    expect(lines(infoSpy).some((l) => l.includes("polling as @probe_bot (id 7)"))).toBe(true);
    const commands = calls.find((c) => c.method === "setMyCommands")?.body.commands;
    expect(commands).toEqual(BOT_COMMANDS.map((c) => ({ ...c })));
    expect(commands as unknown[]).toHaveLength(6);
    const updates = calls.filter((c) => c.method === "getUpdates");
    expect(updates.at(-1)?.body.timeout ?? 0).toBe(0);
    expect(updates.at(-1)?.body.limit).toBe(1);
    expect(updates[0]?.body.allowed_updates).toEqual(["message", "callback_query"]);
  });

  test("retries a 409 with a growing delay", async () => {
    const { bot, calls } = startFake({ getUpdates: (_b, call) => (call <= 2 ? fail(409) : ok([])) });
    const sleeps: number[] = [];
    const polling = startPolling(bot, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 3);
    await polling.stop();

    expect(sleeps).toEqual([60_000, 120_000]);
    const errors = lines(errorSpy).filter((l) => l.includes("409"));
    expect(errors).toHaveLength(2);
    expect(errors[1]).toContain("next try in 2 min");
  });

  test("a good getUpdates call resets the retry count", async () => {
    const { bot, calls } = startFake({
      getUpdates: async (_b, call) => {
        if (call === 2) {
          return ok([]);
        }
        if (call === 1 || call === 3) {
          return fail(409);
        }
        await wait(50);
        return ok([]);
      },
    });
    const sleeps: number[] = [];
    const polling = startPolling(bot, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 4);
    await polling.stop();

    expect(sleeps).toEqual([60_000, 60_000]);
  });

  test("stops at once on a 401", async () => {
    const { bot } = startFake({ getMe: () => fail(401) });
    let slept = 0;
    const polling = startPolling(bot, {
      sleep: async () => {
        slept += 1;
      },
    });
    await polling.done;

    expect(lines(errorSpy).filter((l) => l.includes("rejected (401)"))).toHaveLength(1);
    expect(slept).toBe(0);
    await polling.stop();
  });

  test("goes on when setMyCommands fails", async () => {
    const { bot, calls } = startFake({ setMyCommands: () => fail(400) });
    const polling = startPolling(bot);
    await until(() => lines(warnSpy).some((l) => l.includes("setMyCommands failed: GrammyError setMyCommands 400")));
    await until(() => calls.some((c) => c.method === "getUpdates"));
    await polling.stop();

    expect(lines(warnSpy).filter((l) => l.includes("setMyCommands failed"))).toHaveLength(1);
  });

  test("the default sleep ends early on stop", async () => {
    const { bot, calls } = startFake({ getUpdates: () => fail(409) });
    const polling = startPolling(bot);
    await until(() => calls.some((c) => c.method === "getUpdates"));
    await until(() => lines(errorSpy).some((l) => l.includes("409")));

    const started = Date.now();
    await polling.stop();
    await polling.done;
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("stop resolves and warns when stopping the bot fails", async () => {
    const { bot, calls } = startFake({
      getUpdates: async (body) => {
        if (body.limit === 1) {
          return fail(500);
        }
        await wait(50);
        return ok([]);
      },
    });
    const polling = startPolling(bot);
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 1);
    await polling.stop();

    expect(lines(warnSpy).filter((l) => l.includes("stopping the bot failed"))).toHaveLength(1);
  });

  test("no log line holds the token", async () => {
    const { bot, calls } = startFake({ getUpdates: (_b, call) => (call === 1 ? fail(409) : ok([])) });
    const polling = startPolling(bot, { sleep: async () => undefined });
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 2);
    await polling.stop();

    for (const line of [...lines(infoSpy), ...lines(warnSpy), ...lines(errorSpy)]) {
      expect(line).not.toContain("TOKEN");
    }
  });
});
