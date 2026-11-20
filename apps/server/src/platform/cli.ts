import { type CliDescription, EXIT, renderHelp, UsageError } from "@ea/core";

import { describeError, SoftError } from "./errors";

/** Output of a CLI script for the operator's terminal. Not a log line: no LOG_FORMAT, no level, no allow-list (docs/code-patterns.md § Logs). Only apps/server/src/scripts/ imports it. */
export interface CliOutput {
  /** `[name] text` on stdout. */
  print(text: string): void;
  /** `[name] text` on stderr. */
  fail(text: string): void;
}

/** What `createCliOutput` returns: the `CliOutput` of the text paths, and `raw`, `write`, `writeErr`, `json` for the machine output of a script. */
export interface CliRawOutput extends CliOutput {
  /** `text` on stdout with no prefix: machine output that a person or a test reads line by line (`key value …`). */
  raw(text: string): void;
  /** `text` on stdout, exact bytes: no prefix, no added newline. */
  write(text: string): void;
  /** `text` on stderr, exact bytes: no prefix, no added newline. */
  writeErr(text: string): void;
  /** `JSON.stringify(value)` and a newline on stdout. One call per run; a second call throws. */
  json(value: unknown): void;
}

export function createCliOutput(name: string, options: { json?: boolean } = {}): CliRawOutput {
  const prefix = `[${name}]`;
  let jsonWritten = false;
  return {
    print(text) {
      // With `--json` stdout holds the one JSON value, so text goes to stderr.
      if (options.json) {
        // eslint-disable-next-line no-console
        console.error(prefix, text);
        return;
      }
      // eslint-disable-next-line no-console
      console.log(prefix, text);
    },
    fail(text) {
      // eslint-disable-next-line no-console
      console.error(prefix, text);
    },
    raw(text) {
      // eslint-disable-next-line no-console
      console.log(text);
    },
    write(text) {
      process.stdout.write(text);
    },
    writeErr(text) {
      process.stderr.write(text);
    },
    json(value) {
      if (jsonWritten) {
        throw new Error("json() called twice: a tool writes one JSON value");
      }
      jsonWritten = true;
      process.stdout.write(`${JSON.stringify(value)}\n`);
    },
  };
}

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "57P03"]);
const CAUSE_DEPTH = 5;
// pg-pool rejects `connect()` with this text after `connectionTimeoutMillis`; the pool sets no code.
const POOL_CONNECT_TIMEOUT = "timeout exceeded when trying to connect";

function isUnreachable(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > CAUSE_DEPTH) {
    return false;
  }
  if (error instanceof SoftError) {
    return true;
  }
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) {
    return true;
  }
  if (error instanceof Error && error.message === POOL_CONNECT_TIMEOUT) {
    return true;
  }
  return isUnreachable(cause, depth + 1);
}

/** The exit code of an error that is not a usage error: 3 when the outside system was unreachable (docs/cli.md), else 1. For tools with their own outer catch. */
export function exitCodeOf(error: unknown): 1 | 3 {
  return isUnreachable(error) ? EXIT.unreachable : EXIT.failed;
}

function isUsageError(error: unknown): boolean {
  if (error instanceof UsageError) {
    return true;
  }
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}

/** The tokens before the first `--`: what the standard flags `--help`, `-h` and `--json` look at. */
function flagTokens(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf("--");
  return end === -1 ? argv : argv.slice(0, end);
}

/** The description of the subcommand in `argv[0]`; every description when none matches (or the tool has one). */
function pickDescriptions(descriptions: readonly CliDescription[], argv: readonly string[]): readonly CliDescription[] {
  const match = descriptions.find((d) => d.subcommand !== undefined && d.subcommand === argv[0]);
  return match ? [match] : descriptions;
}

export interface CliSpec {
  /** The output name, `org-delete`: the `[prefix]` of every line. */
  prefix: string;
  descriptions: readonly CliDescription[];
  /** Returns the exit code. Throw a `UsageError` for bad arguments; any other throw is a failure. */
  main: (argv: string[], out: CliRawOutput) => Promise<number>;
  /** Default `process.argv.slice(2)`. */
  argv?: string[];
  /** Closes the DB pool; runs in `finally`. */
  close?: () => Promise<void>;
}

/** The standard run of a tool (docs/cli.md): help, the exit-code table, one safe line for an uncaught error. Returns the code; `runCli` exits with it. */
export async function runCliCode(spec: CliSpec): Promise<number> {
  const argv = spec.argv ?? process.argv.slice(2);
  const flags = flagTokens(argv);
  const out = createCliOutput(spec.prefix, { json: flags.includes("--json") });
  if (flags.includes("--help") || flags.includes("-h")) {
    out.write(
      pickDescriptions(spec.descriptions, argv)
        .map((d) => renderHelp(d))
        .join("\n")
    );
    return EXIT.ok;
  }
  try {
    return await spec.main(argv, out);
  } catch (error) {
    if (isUsageError(error)) {
      // The message of a UsageError is safe text; a parseArgs message names only the flag.
      out.fail(error instanceof Error ? error.message : describeError(error));
      for (const d of pickDescriptions(spec.descriptions, argv)) {
        out.fail(`usage: ${d.usage}`);
      }
      return EXIT.usage;
    }
    if (isUnreachable(error)) {
      out.fail(`unreachable: ${describeError(error)}`);
      return EXIT.unreachable;
    }
    out.fail(`failed: ${describeError(error)}`);
    return EXIT.failed;
  } finally {
    if (spec.close) {
      try {
        await spec.close();
      } catch (error) {
        out.fail(`close failed: ${describeError(error)}`);
      }
    }
  }
}

/** `runCliCode`, then `process.exit` with its code: the one exit site of a script. */
export async function runCli(spec: CliSpec): Promise<never> {
  const code = await runCliCode(spec);
  process.exit(code);
}
