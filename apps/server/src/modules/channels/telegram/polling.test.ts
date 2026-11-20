import { format } from "node:util";

import { botCommandNames, MINUTE_MS, textTables } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Bot } from "grammy";

import { setLogFormat, setLogLevel } from "../../../platform/log";
import { commandNames } from "../port";

import { BOT_COMMANDS, startPolling } from "./polling";

const TOKEN = "123456:MARKERTOKENaaaaaaaaaaaaaaaaaaaaaaaaaa";

type Answer = (body: Record<string, unknown>, call: number) => Promise<Response> | Response;
type FakeServer = ReturnType<typeof Bun.serve>;

const servers: FakeServer[] = [];
let infoSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
// Every line of both console streams, formatted like the console does, so a raw error object shows its fields.
let written: string[] = [];

const ok = (result: unknown): Response => Response.json({ ok: true, result });
// The description holds the bot token: only a correct field list keeps it out of a log line.
const fail = (code: number): Response =>
  Response.json({ ok: false, error_code: code, description: `fake ${code} ${TOKEN}` }, { status: code });
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

const BASE_KEYS = ["time", "level", "module", "event", "msg"];

interface LoggedEvent {
  level: string;
  fields: Record<string, unknown>;
}

// The `telegram` event lines of one name: the level and the fields after the base keys. A dropped field shows as
// `dropped_fields`, so an exact match on `fields` also proves that every value passed the logger.
function eventsOf(event: string): LoggedEvent[] {
  return written.flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.module !== "telegram" || parsed.event !== event) return [];
    const fields = Object.fromEntries(Object.entries(parsed).filter(([key]) => !BASE_KEYS.includes(key)));
    return [{ level: String(parsed.level), fields }];
  });
}

const expectNoMarker = (): void => {
  for (const line of written) {
    expect(line).not.toContain("MARKER");
    expect(line).not.toContain("probe_bot");
  }
};

beforeEach(() => {
  setLogFormat("json");
  setLogLevel("debug");
  written = [];
  infoSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    written.push(format(...args));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    written.push(format(...args));
  });
});

afterEach(() => {
  for (const server of servers.splice(0)) {
    void server.stop(true);
  }
  infoSpy.mockRestore();
  errorSpy.mockRestore();
  setLogFormat("text");
  setLogLevel("info");
});

describe("startPolling", () => {
  test("polls, sets the commands and stops cleanly", async () => {
    const { bot, calls } = startFake();
    const polling = startPolling(bot);
    await until(() => calls.filter((c) => c.method === "setMyCommands").length >= 2);
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 1);

    await polling.stop();
    await polling.done;

    expect(eventsOf("telegram_polling_started")).toEqual([{ level: "info", fields: { bot_id: 7 } }]);
    expectNoMarker();
    const menus = calls.filter((c) => c.method === "setMyCommands");
    expect(menus).toHaveLength(2);
    // 1. The default menu (English): today's list, no language code.
    expect(menus[0]?.body.commands).toEqual(BOT_COMMANDS.map((c) => ({ ...c })));
    expect(menus[0]?.body.commands as unknown[]).toHaveLength(6);
    expect(menus[0]?.body.language_code).toBeUndefined();
    // 2. The Polish menu for Telegram apps set to Polish.
    expect(menus[1]?.body.language_code).toBe("pl");
    expect(menus[1]?.body.commands).toEqual(
      botCommandNames.map((command) => ({ command, description: textTables.pl.bot.commands[command] }))
    );
    expect((menus[1]?.body.commands as { description: string }[]).map((c) => c.description)).toEqual([
      "Podsumowanie teraz",
      "Skrzynki, ostatnia synchronizacja, wywołania AI",
      "Wstrzymaj czytanie i klasyfikację",
      "Wznów czytanie i klasyfikację",
      "Oznacz próbkę ostatnich wiadomości",
      "Lista poleceń",
    ]);
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

    expect(sleeps).toEqual([MINUTE_MS, 2 * MINUTE_MS]);
    // `wait_ms` is the wait in milliseconds; the description of Telegram (it holds the token here) is not logged.
    expect(eventsOf("telegram_polling_conflict")).toEqual([
      { level: "error", fields: { wait_ms: MINUTE_MS } },
      { level: "error", fields: { wait_ms: 120_000 } },
    ]);
    expectNoMarker();
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

    expect(sleeps).toEqual([MINUTE_MS, MINUTE_MS]);
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

    expect(eventsOf("telegram_polling_token_rejected")).toEqual([{ level: "error", fields: {} }]);
    expect(slept).toBe(0);
    expectNoMarker();
    await polling.stop();
  });

  test("goes on when setMyCommands fails", async () => {
    const { bot, calls } = startFake({ setMyCommands: () => fail(400) });
    const polling = startPolling(bot);
    await until(() => eventsOf("telegram_set_commands_failed").length >= 2);
    await until(() => calls.some((c) => c.method === "getUpdates"));
    await polling.stop();

    // One warning for each of the two calls; the description (it holds the token here) is not logged.
    const failed = { level: "warn", fields: { error: "GrammyError", error_code: 400, method: "setMyCommands" } };
    expect(eventsOf("telegram_set_commands_failed")).toEqual([failed, failed]);
    expectNoMarker();
  });

  test("the default sleep ends early on stop", async () => {
    const { bot, calls } = startFake({ getUpdates: () => fail(409) });
    const polling = startPolling(bot);
    await until(() => calls.some((c) => c.method === "getUpdates"));
    await until(() => eventsOf("telegram_polling_conflict").length >= 1);

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

    expect(eventsOf("telegram_stop_failed")).toEqual([
      { level: "warn", fields: { error: "GrammyError", error_code: 500, method: "getUpdates" } },
    ]);
    expectNoMarker();
  });

  // grammY retries a network error and a 5xx inside `bot.start`; a 404 and any other error leave it.
  test("a refused getMe writes telegram_polling_failed with the fields only", async () => {
    const { bot, calls } = startFake({ getMe: (_b, call) => (call === 1 ? fail(404) : ok(me)) });
    const polling = startPolling(bot, { sleep: async () => undefined });
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 1);
    await polling.stop();

    expect(eventsOf("telegram_polling_failed")).toEqual([
      { level: "error", fields: { error: "GrammyError", error_code: 404, method: "getMe", wait_ms: MINUTE_MS } },
    ]);
    expectNoMarker();
  });

  test("another error writes telegram_polling_failed with the error name only", async () => {
    const { bot, calls } = startFake();
    let first = true;
    bot.api.config.use((prev, method, payload, signal) => {
      if (method === "getMe" && first) {
        first = false;
        throw new Error(`https://api.telegram.org/bot${TOKEN}/getMe`);
      }
      return prev(method, payload, signal);
    });
    const polling = startPolling(bot, { sleep: async () => undefined });
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 1);
    await polling.stop();

    expect(eventsOf("telegram_polling_failed")).toEqual([
      { level: "error", fields: { error: "Error", wait_ms: MINUTE_MS } },
    ]);
    expectNoMarker();
  });

  test("no log line holds the token", async () => {
    const { bot, calls } = startFake({ getUpdates: (_b, call) => (call === 1 ? fail(409) : ok([])) });
    const polling = startPolling(bot, { sleep: async () => undefined });
    await until(() => calls.filter((c) => c.method === "getUpdates").length >= 2);
    await polling.stop();

    expect(written.length).toBeGreaterThan(0);
    for (const line of written) {
      expect(line).not.toContain("TOKEN");
    }
  });
});

// The command list of the server (`port.ts`) and the texts of core (`botCommandNames`) must name the same commands.
describe("the command lists", () => {
  test("the server list and the texts hold the same commands in both languages", () => {
    expect([...commandNames].sort()).toEqual([...botCommandNames].sort());
    for (const locale of ["en", "pl"] as const) {
      expect(Object.keys(textTables[locale].bot.commands).sort()).toEqual([...commandNames].sort());
    }
  });
});
