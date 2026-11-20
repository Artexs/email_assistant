import { EXIT } from "@ea/core";

import { cliDescriptions, DEFAULT_URL, parseFakeTgArgs, type FakeTgArgs } from "./cli-args";
import { runToolCli, type CliIo } from "./cli-run";
import {
  createFakeTelegramClient,
  FakeTelegramRequestError,
  FakeTelegramTimeout,
  FakeTelegramUnreachable,
} from "./driver";
import { startFakeTelegram } from "./server";
import { DEFAULT_PORT, FAKE_TOKEN, type FakeMessage } from "./state";

export type { CliIo };

const pad = (n: number) => String(n).padStart(2, "0");

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatMessage(message: FakeMessage): string {
  const edited = message.edits.length > 0 ? ` · edited ${message.edits.length}x` : "";
  const lines = [`#${message.messageId} ${message.from} ${formatTime(message.date)} UTC${edited}`, message.text];
  for (const row of message.buttons) {
    lines.push(`  ${row.map((b) => `[${b.text} => ${b.data}]`).join("  ")}`);
  }
  return lines.join("\n");
}

async function serve(args: Extract<FakeTgArgs, { command: "serve" }>, io: CliIo): Promise<number> {
  const port = args.port ?? DEFAULT_PORT;
  const token = io.env.FAKE_TG_TOKEN ?? io.env.FAKE_TOKEN ?? FAKE_TOKEN;
  let fake;
  try {
    fake = startFakeTelegram({ port, token });
  } catch (error) {
    io.err(`fake-tg: ${(error as Error).message}`);
    return EXIT.failed;
  }
  const { bot } = await createFakeTelegramClient(fake.apiRoot).health();
  io.out(`fake Telegram on ${fake.apiRoot} (bot @${bot.username}, id ${bot.id})`);
  io.out(`TELEGRAM_API_ROOT=${fake.apiRoot}`);
  if (token === FAKE_TOKEN) io.out(`TELEGRAM_BOT_TOKEN=${FAKE_TOKEN}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await fake.stop();
  return EXIT.ok;
}

async function execute(argv: string[], io: CliIo): Promise<number> {
  const args = parseFakeTgArgs(argv);
  if (args.command === "serve") return serve(args, io);

  const client = createFakeTelegramClient(args.url ?? io.env.FAKE_TG_URL ?? DEFAULT_URL);
  const { chatId } = args;
  const print = (data: object, text: string[]) => {
    if (args.json) io.out(JSON.stringify(data));
    else for (const line of text) io.out(line);
  };

  switch (args.command) {
    case "send": {
      const sent = await client.send(args.text, { chatId });
      print(sent, [`sent #${sent.messageId} (update ${sent.updateId})`]);
      return EXIT.ok;
    }
    case "press": {
      const pressed = await client.press({
        chatId,
        messageId: args.messageId,
        button: args.button,
        data: args.data,
        timeoutMs: args.timeoutSeconds === undefined ? undefined : Math.round(args.timeoutSeconds * 1000),
      });
      print(pressed, [`pressed "${args.button ?? args.data}" on #${pressed.messageId}`, `answer: ${pressed.answer}`]);
      return EXIT.ok;
    }
    case "read": {
      const { last } = args;
      const all = await client.read({ chatId, strict: true });
      const messages = last === undefined ? all : last === 0 ? [] : all.slice(-last);
      print(
        messages,
        messages.flatMap((m, i) => (i === 0 ? [formatMessage(m)] : ["", formatMessage(m)]))
      );
      return EXIT.ok;
    }
    case "wait": {
      const message = await client.waitFor(args.pattern, {
        chatId,
        timeoutMs: Math.round(args.timeoutSeconds * 1000),
        afterMessageId: args.afterMessageId,
      });
      print(message, [formatMessage(message)]);
      return EXIT.ok;
    }
  }
}

/** The command line of `fake-tg` as a function: the exit code of one run. Bad arguments throw `UsageError`; `runToolCli` maps them to 2. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    return await execute(argv, io);
  } catch (error) {
    if (error instanceof FakeTelegramUnreachable) {
      io.err(`fake-tg: ${error.message}`);
      return EXIT.unreachable;
    }
    if (error instanceof FakeTelegramTimeout || error instanceof FakeTelegramRequestError) {
      io.err(`fake-tg: ${error.message}`);
      return EXIT.failed;
    }
    throw error;
  }
}

if (import.meta.main) {
  await runToolCli({ prefix: "fake-tg", descriptions: cliDescriptions, main: runCli });
}
