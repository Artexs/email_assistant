import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

import { DEFAULT_PORT } from "./state";

export const cliDescriptions = [
  {
    name: "fake-tg",
    summary: "Runs the fake Telegram server, or sends text, presses buttons and reads messages on it.",
    risk: "dev",
    needs: ["none"],
    usage: [
      "bun run fake-tg <command> [options]",
      "  serve [--port <n>]",
      "  send <text> [--chat <id>]",
      "  press (--button <text> | --data <data>) [--message <id>] [--chat <id>] [--timeout <s>]",
      "  read [--chat <id>] [--last <n>]",
      "  wait <regex> [--chat <id>] [--timeout <s>] [--after <messageId>]",
      "global options: --url <base>, --json",
    ].join("\n"),
    exits: {
      1: "the fake refused, a wait timed out, or serve could not open its port",
      3: "the fake server did not answer",
    },
    outputNote: "chat text of the fake Telegram, which holds test data only",
  },
] satisfies readonly CliDescription[];

export const DEFAULT_WAIT_SECONDS = 30;
export const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

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

interface Global {
  /** `--url`; the caller falls back to `FAKE_TG_URL` and the default. */
  url: string | undefined;
  json: boolean;
}

export type FakeTgArgs = Global &
  (
    | { command: "serve"; port: number | undefined }
    | { command: "send"; text: string; chatId: number | undefined }
    | {
        command: "press";
        chatId: number | undefined;
        messageId: number | undefined;
        button: string | undefined;
        data: string | undefined;
        timeoutSeconds: number | undefined;
      }
    | { command: "read"; chatId: number | undefined; last: number | undefined }
    | {
        command: "wait";
        pattern: RegExp;
        chatId: number | undefined;
        timeoutSeconds: number;
        afterMessageId: number | undefined;
      }
  );

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

/** Throws `UsageError` on any bad argument; nothing is read from env or the network. */
export function parseFakeTgArgs(argv: string[]): FakeTgArgs {
  let parsed;
  try {
    parsed = parseArgs({ args: joinNegativeChat(argv), options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (!command) throw new UsageError("needs a command");
  const common = { url: values.url, json: values.json === true };

  if (command === "serve") {
    if (rest.length > 0) throw new UsageError("serve takes no argument");
    return { ...common, command, port: toNumber("port", values.port, true) };
  }
  if (!["send", "press", "read", "wait"].includes(command)) throw new UsageError(`unknown command "${command}"`);

  const chatId = toNumber("chat", values.chat, true, true);
  switch (command) {
    case "send": {
      const [text] = rest;
      if (rest.length !== 1 || text === undefined) throw new UsageError("send needs one <text>");
      return { ...common, command, text, chatId };
    }
    case "press": {
      if (rest.length > 0) throw new UsageError("press takes no argument");
      if ((values.button === undefined) === (values.data === undefined)) {
        throw new UsageError("press needs exactly one of --button and --data");
      }
      return {
        ...common,
        command,
        chatId,
        messageId: toNumber("message", values.message, true),
        button: values.button,
        data: values.data,
        timeoutSeconds: toNumber("timeout", values.timeout, false),
      };
    }
    case "read": {
      if (rest.length > 0) throw new UsageError("read takes no argument");
      return { ...common, command, chatId, last: toNumber("last", values.last, true) };
    }
    default: {
      const [source] = rest;
      if (rest.length !== 1 || source === undefined) throw new UsageError("wait needs one <regex>");
      let pattern: RegExp;
      try {
        pattern = new RegExp(source, "s");
      } catch (error) {
        throw new UsageError(`bad regex: ${(error as Error).message}`);
      }
      return {
        ...common,
        command: "wait",
        pattern,
        chatId,
        timeoutSeconds: toNumber("timeout", values.timeout, false) ?? DEFAULT_WAIT_SECONDS,
        afterMessageId: toNumber("after", values.after, true),
      };
    }
  }
}
