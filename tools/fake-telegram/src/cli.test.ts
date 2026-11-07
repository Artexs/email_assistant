import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { Bot } from "grammy";

import { runCli, type CliIo } from "./cli";
import { startFakeTelegram, type FakeTelegram } from "./server";
import { FAKE_TOKEN } from "./state";

let fake: FakeTelegram | undefined;
let bot: Bot | undefined;

afterEach(async () => {
  await bot?.stop();
  bot = undefined;
  await fake?.stop();
  fake = undefined;
});

function start() {
  fake = startFakeTelegram();
  bot = new Bot(FAKE_TOKEN, { client: { apiRoot: fake.apiRoot } });
  bot.command("start", (ctx) =>
    ctx.reply(`hi ${ctx.match}`, { reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "y" }]] } })
  );
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery({ text: "ok" }));
  void bot.start();
  return fake.apiRoot;
}

async function run(args: string[], url: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: {} };
  const code = await runCli([...args, "--url", url], io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("fake-tg cli", () => {
  test("send, wait, read, press", async () => {
    const url = start();
    expect((await run(["send", "/start x"], url)).code).toBe(0);
    const waited = await run(["wait", "hi x"], url);
    expect(waited.code).toBe(0);
    expect(waited.out).toContain("#2 bot");
    expect((await run(["read"], url)).out).toContain("[Yes => y]");
    const pressed = await run(["press", "--button", "Yes"], url);
    expect(pressed.code).toBe(0);
    expect(pressed.out).toContain("answer: ok");
    expect((await run(["read", "--last", "1"], url)).out).not.toContain("#1 user");
  });

  test("--json read prints one valid JSON line", async () => {
    const url = start();
    await run(["send", "/start j"], url);
    await run(["wait", "hi j"], url);
    const result = await run(["--json", "read"], url);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toHaveLength(2);
  });

  test("exit codes", async () => {
    const url = start();
    await run(["send", "/start x"], url);
    expect((await run(["wait", "never", "--timeout", "0.3"], url)).code).toBe(1);
    expect((await run(["press", "--button", "Nope"], url)).code).toBe(1);
    expect((await run(["bogus"], url)).code).toBe(2);
    expect((await run(["wait", "("], url)).code).toBe(2);
    expect((await run(["read"], "http://127.0.0.1:1")).code).toBe(3);
  });

  test("read exits 1 when the chat does not exist", async () => {
    const url = start();
    const result = await run(["read", "--chat", "999"], url);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no such chat");
  });

  test("--chat takes a negative id", async () => {
    const url = start();
    expect((await run(["send", "hello", "--chat", "-1001234"], url)).code).toBe(0);
    const split = await run(["read", "--chat", "-1001234"], url);
    expect(split.code).toBe(0);
    expect(split.out).toContain("hello");
    const joined = await run(["read", "--chat=-1001234"], url);
    expect(joined.code).toBe(0);
    expect(joined.out).toContain("hello");
    expect((await run(["send", "/start x", "--chat", "-1001234"], url)).code).toBe(0);
    expect((await run(["wait", "hi x", "--chat", "-1001234", "--timeout", "5"], url)).code).toBe(0);
  });

  test("only --chat takes a negative number", async () => {
    const url = "http://127.0.0.1:1"; // usage errors come before any request
    const last = await run(["read", "--chat", "-5", "--last=-1"], url);
    expect(last.code).toBe(2);
    expect(last.err).toContain('--last needs a whole number, got "-1"');
    const joined = await run(["read", "--chat=-1.5"], url);
    expect(joined.code).toBe(2);
    expect(joined.err).toContain("--chat needs a whole number");
    expect((await run(["read", "--chat", "-1.5"], url)).code).toBe(2);
  });

  test("serve on a busy port prints one error line and exits 1", async () => {
    const busy = startFakeTelegram({ port: 0 });
    try {
      const proc = Bun.spawn(
        [process.execPath, join(import.meta.dir, "cli.ts"), "serve", "--port", String(busy.port)],
        {
          stdout: "ignore",
          stderr: "pipe",
        }
      );
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(1);
      expect(stderr.startsWith("fake-tg: ")).toBe(true);
      expect(stderr.trim().split("\n")).toHaveLength(1);
    } finally {
      await busy.stop();
    }
  });

  test("serve never prints a custom token", async () => {
    const secret = "9999999:custom-secret-token-value-for-test";
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "serve", "--port", "0"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FAKE_TG_TOKEN: secret },
    });
    let printed = "";
    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      while (!printed.includes("TELEGRAM_API_ROOT=")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        printed += decoder.decode(chunk.value);
      }
    } finally {
      proc.kill();
    }
    await proc.exited;
    printed += await new Response(proc.stderr).text();
    expect(printed).toContain("TELEGRAM_API_ROOT=");
    expect(printed).not.toContain(secret);
    expect(printed).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  test("serve prints the bound port and stops on a signal", async () => {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "serve", "--port", "0"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    try {
      const reader = proc.stdout.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      const match = first.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      expect(match).not.toBeNull();
      const health = await fetch(`http://127.0.0.1:${match?.[1]}/_fake/health`);
      expect(health.status).toBe(200);
    } finally {
      proc.kill();
    }
    expect(await proc.exited).toBe(0);
  });
});
