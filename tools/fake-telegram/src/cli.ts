import { parseArgs } from "node:util";

import {
  createFakeTelegramClient,
  FakeTelegramRequestError,
  FakeTelegramTimeout,
  FakeTelegramUnreachable,
} from "./driver";
import { startFakeTelegram } from "./server";
import { DEFAULT_PORT, FAKE_TOKEN, type FakeMessage } from "./state";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  env: Record<string, string | undefined>;
}

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_UNREACHABLE = 3;

const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const DEFAULT_WAIT_SECONDS = 30;

const USAGE = `usage: fake-tg <command> [options]
  serve [--port <n>]
  send <text> [--chat <id>]
  press (--button <text> | --data <data>) [--message <id>] [--chat <id>] [--timeout <s>]
  read [--chat <id>] [--last <n>]
  wait <regex> [--chat <id>] [--timeout <s>] [--after <messageId>]
global options: --url <base>, --json`;

class UsageError extends Error {}

const options = {
  port: { type: "string" },
  chat: { type: "string" },
  button: { type: "string" },
  data: { type: "string" },
  message: { type: "string" },
  timeout: { type: "string" },
  last: { type: "string" },
  after: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean" },
} as const;

function toNumber(
  name: string,
  value: string | undefined,
  integer: boolean,
  allowNegative = false
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n) || (n < 0 && !allowNegative) || (integer && !Number.isInteger(n))) {
    throw new UsageError(`--${name} needs a ${integer ? "whole " : ""}number, got "${value}"`);
  }
  return n;
}

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

async function serve(values: { port?: string }, io: CliIo): Promise<number> {
  const port = toNumber("port", values.port, true) ?? DEFAULT_PORT;
  const token = io.env.FAKE_TG_TOKEN ?? io.env.FAKE_TOKEN ?? FAKE_TOKEN;
  let fake;
  try {
    fake = startFakeTelegram({ port, token });
  } catch (error) {
    io.err(`fake-tg: ${(error as Error).message}`);
    return EXIT_FAILED;
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
  return EXIT_OK;
}

// parseArgs refuses "--chat -100…" as ambiguous, so join the pair into "--chat=-100…".
function joinNegativeChat(argv: string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--chat" && next !== undefined && /^-\d+$/.test(next)) {
      joined.push(`--chat=${next}`);
      i++;
    } else {
      joined.push(argv[i] as string);
    }
  }
  return joined;
}

async function execute(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: joinNegativeChat(argv), options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (!command) throw new UsageError(USAGE);

  if (command === "serve") {
    if (rest.length > 0) throw new UsageError("serve takes no argument");
    return serve(values, io);
  }

  const client = createFakeTelegramClient(values.url ?? io.env.FAKE_TG_URL ?? DEFAULT_URL);
  const chatId = toNumber("chat", values.chat, true, true);
  const json = values.json === true;
  const print = (data: object, text: string[]) => {
    if (json) io.out(JSON.stringify(data));
    else for (const line of text) io.out(line);
  };

  switch (command) {
    case "send": {
      const [text] = rest;
      if (rest.length !== 1 || text === undefined) throw new UsageError("send needs one <text>");
      const sent = await client.send(text, { chatId });
      print(sent, [`sent #${sent.messageId} (update ${sent.updateId})`]);
      return EXIT_OK;
    }
    case "press": {
      if (rest.length > 0) throw new UsageError("press takes no argument");
      if ((values.button === undefined) === (values.data === undefined)) {
        throw new UsageError("press needs exactly one of --button and --data");
      }
      const timeout = toNumber("timeout", values.timeout, false);
      const pressed = await client.press({
        chatId,
        messageId: toNumber("message", values.message, true),
        button: values.button,
        data: values.data,
        timeoutMs: timeout === undefined ? undefined : Math.round(timeout * 1000),
      });
      print(pressed, [
        `pressed "${values.button ?? values.data}" on #${pressed.messageId}`,
        `answer: ${pressed.answer}`,
      ]);
      return EXIT_OK;
    }
    case "read": {
      if (rest.length > 0) throw new UsageError("read takes no argument");
      const last = toNumber("last", values.last, true);
      const all = await client.read({ chatId, strict: true });
      const messages = last === undefined ? all : last === 0 ? [] : all.slice(-last);
      print(
        messages,
        messages.flatMap((m, i) => (i === 0 ? [formatMessage(m)] : ["", formatMessage(m)]))
      );
      return EXIT_OK;
    }
    case "wait": {
      const [source] = rest;
      if (rest.length !== 1 || source === undefined) throw new UsageError("wait needs one <regex>");
      let pattern: RegExp;
      try {
        pattern = new RegExp(source, "s");
      } catch (error) {
        throw new UsageError(`bad regex: ${(error as Error).message}`);
      }
      const timeout = toNumber("timeout", values.timeout, false) ?? DEFAULT_WAIT_SECONDS;
      const message = await client.waitFor(pattern, {
        chatId,
        timeoutMs: Math.round(timeout * 1000),
        afterMessageId: toNumber("after", values.after, true),
      });
      print(message, [formatMessage(message)]);
      return EXIT_OK;
    }
    default:
      throw new UsageError(`unknown command "${command}"\n${USAGE}`);
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    return await execute(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`fake-tg: ${error.message}`);
      return EXIT_USAGE;
    }
    if (error instanceof FakeTelegramUnreachable) {
      io.err(`fake-tg: ${error.message}`);
      return EXIT_UNREACHABLE;
    }
    if (error instanceof FakeTelegramTimeout || error instanceof FakeTelegramRequestError) {
      io.err(`fake-tg: ${error.message}`);
      return EXIT_FAILED;
    }
    throw error;
  }
}

if (import.meta.main) {
  void runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    env: process.env,
  }).then((code) => process.exit(code));
}
