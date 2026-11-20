import { type CliDescription, EXIT, renderHelp, UsageError } from "@ea/core";

// The one file of this tool that calls `process.exit` or writes to the process streams. A tool never imports `apps/`
// (docs/cli.md), so this is the `runCli` contract of `apps/server/src/platform/cli.ts` in small: help, usage error, exit code.

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  env: Record<string, string | undefined>;
}

export interface ToolCliSpec {
  /** The `prefix: ` of every problem line, `fake-tg`. */
  prefix: string;
  descriptions: readonly CliDescription[];
  /** Returns the exit code. Throw a `UsageError` for bad arguments; any other throw is a failure. */
  main: (argv: string[], io: CliIo) => Promise<number>;
  /** Default `process.argv.slice(2)`. */
  argv?: string[];
  /** Default: the process streams and `process.env`. */
  io?: CliIo;
}

const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
};

// `UsageError` of `@ea/core`, or the error that `util.parseArgs` throws for an unknown flag or a missing value.
function isUsageError(error: unknown): boolean {
  if (error instanceof UsageError) return true;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_");
}

// The tokens before the first `--`: `fake-tg send -- -h` sends `-h`.
function flagTokens(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf("--");
  return end === -1 ? argv : argv.slice(0, end);
}

/** Help, the exit-code table and one safe line for an uncaught error. Returns the code; `runToolCli` exits with it. */
export async function runToolCliCode(spec: ToolCliSpec): Promise<number> {
  const argv = spec.argv ?? process.argv.slice(2);
  const io = spec.io ?? processIo;
  const flags = flagTokens(argv);
  if (flags.includes("--help") || flags.includes("-h")) {
    io.out(spec.descriptions.map((d) => renderHelp(d).trimEnd()).join("\n"));
    return EXIT.ok;
  }
  try {
    return await spec.main(argv, io);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isUsageError(error)) {
      io.err(`${spec.prefix}: ${text}`);
      for (const d of spec.descriptions) io.err(`usage: ${d.usage}`);
      return EXIT.usage;
    }
    io.err(`${spec.prefix}: failed: ${text}`);
    return EXIT.failed;
  }
}

/** `runToolCliCode`, then `process.exit` with its code. */
export async function runToolCli(spec: ToolCliSpec): Promise<never> {
  const code = await runToolCliCode(spec);
  process.exit(code);
}
