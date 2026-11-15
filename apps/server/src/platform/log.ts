import { AsyncLocalStorage } from "node:async_hooks";

import { EVENT_CODE, isLogValueOfKind, logFieldKind, type LogFields } from "./log-fields";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "text";
export type { LogFields } from "./log-fields";

export interface LogContext {
  job?: string;
  run_id?: string;
  request_id?: string;
}

const contextKeys = ["job", "run_id", "request_id"] as const;
const contextStorage = new AsyncLocalStorage<Readonly<LogContext>>();

/** D15: every line written inside fn (also after await) carries these keys. A nested call adds keys; an outer key keeps its value. */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  const defined = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
  const merged: LogContext = { ...defined, ...contextStorage.getStore() };
  return contextStorage.run(merged, fn);
}

export interface Log {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A child logger: every line adds `fields` after the context keys (D3, D8). */
  with(fields: LogFields): Log;
}

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = "info";
let currentFormat: LogFormat | undefined;
let currentRelease: string | undefined;
let droppedTotal = 0;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setLogFormat(format: LogFormat): void {
  currentFormat = format;
}

/** F114 D10: the release name (`EA_RELEASE`). After this call every JSON line carries `release`. Text lines stay as they are. `undefined` turns it off (tests). */
export function setLogRelease(release: string | undefined): void {
  currentRelease = release;
}

/** D11: "json" gives json; anything else, also unset, gives text (a process that never loads the config is a CLI or a test). */
export function logFormatFromEnv(env: Record<string, string | undefined>): LogFormat {
  return env.LOG_FORMAT === "json" ? "json" : "text";
}

/** D8: fields dropped since the process started. Tests read a difference. */
export function droppedLogFields(): number {
  return droppedTotal;
}

type Pair = readonly [string, unknown];
type FieldSource = Record<string, unknown>;

// `release` is reserved: only setLogRelease writes it.
const baseKeys: ReadonlySet<string> = new Set(["time", "level", "module", "event", "msg", "release"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isEventForm(args: readonly unknown[]): boolean {
  if (args.length < 1 || args.length > 2) {
    return false;
  }
  const [event, fields] = args;
  return typeof event === "string" && EVENT_CODE.test(event) && (fields === undefined || isPlainObject(fields));
}

/** Adds the allowed fields of each source, in order. Returns the number of dropped fields. */
function addFields(pairs: Pair[], sources: readonly FieldSource[]): number {
  const seen = new Set(baseKeys);
  let dropped = 0;
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      try {
        const value = source[key];
        if (value === undefined) {
          continue;
        }
        const kind = logFieldKind(key);
        if (kind !== undefined && isLogValueOfKind(kind, value) && !seen.has(key)) {
          seen.add(key);
          pairs.push([key, value]);
        } else {
          dropped += 1;
        }
      } catch {
        dropped += 1;
      }
    }
  }
  return dropped;
}

function resolveFormat(): LogFormat {
  currentFormat ??= logFormatFromEnv(process.env);
  return currentFormat;
}

/** The context store as a field source, keys in the fixed order job, run_id, request_id. */
function contextFields(): FieldSource {
  const store: FieldSource = contextStorage.getStore() ?? {};
  const ordered: FieldSource = {};
  for (const key of contextKeys) {
    if (store[key] !== undefined) {
      ordered[key] = store[key];
    }
  }
  return ordered;
}

/** One line: JSON, or text with the event first and the fields as `key=value`. */
function writeLine(
  out: (...args: unknown[]) => void,
  prefix: string,
  event: string,
  pairs: readonly Pair[],
  asJson: boolean
): void {
  if (asJson) {
    out(JSON.stringify(Object.fromEntries(pairs)));
    return;
  }
  const rest = pairs
    .slice(5)
    .map(([key, value]) => ` ${key}=${String(value)}`)
    .join("");
  out(prefix, `${event}${rest}`);
}

/** While the console guard is on, the writer sends its lines here, not to console.*. */
let guardSink: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void } | undefined;

function sinkFor(level: LogLevel): (...args: unknown[]) => void {
  const toError = level === "warn" || level === "error";
  if (guardSink !== undefined) {
    return toError ? guardSink.error : guardSink.log;
  }
  // eslint-disable-next-line no-console
  return toError ? console.error : console.log;
}

/** One line of context fields and dropped_fields 1, for a call shape that is not the event form and for library console output. It writes no argument. */
function writeDropOnly(level: LogLevel, module: string, event: string): void {
  const line: Pair[] = [
    ["time", new Date().toISOString()],
    ["level", level],
    ["module", module],
    ["event", event],
    ["msg", event],
  ];
  if (currentRelease !== undefined && resolveFormat() === "json") {
    line.push(["release", currentRelease]);
  }
  const dropped = addFields(line, [contextFields()]) + 1;
  line.push(["dropped_fields", dropped]);
  droppedTotal += dropped;
  writeLine(sinkFor(level), `[${module}]`, event, line, resolveFormat() === "json");
}

function write(level: LogLevel, module: string, childFields: readonly FieldSource[], args: readonly unknown[]): void {
  if (levelOrder[level] < levelOrder[currentLevel]) {
    return;
  }
  const out = sinkFor(level);
  const prefix = `[${module}]`;
  const asJson = resolveFormat() === "json";

  if (!isEventForm(args)) {
    writeDropOnly(level, module, "log_call_invalid");
    return;
  }

  const event = args[0] as string;
  const callFields = (args[1] ?? {}) as FieldSource;
  const pairs: Pair[] = [
    ["time", new Date().toISOString()],
    ["level", level],
    ["module", module],
    ["event", event],
    ["msg", event],
  ];
  if (currentRelease !== undefined && asJson) {
    pairs.push(["release", currentRelease]);
  }
  const dropped = addFields(pairs, [contextFields(), ...childFields, callFields]);
  if (dropped > 0) {
    pairs.push(["dropped_fields", dropped]);
    droppedTotal += dropped;
  }

  writeLine(out, prefix, event, pairs, asJson);
}

function makeLog(module: string, childFields: readonly FieldSource[]): Log {
  return {
    debug: (...args: unknown[]) => write("debug", module, childFields, args),
    info: (...args: unknown[]) => write("info", module, childFields, args),
    warn: (...args: unknown[]) => write("warn", module, childFields, args),
    error: (...args: unknown[]) => write("error", module, childFields, args),
    with: (fields: LogFields) => makeLog(module, [...childFields, fields]),
  };
}

export function createLog(module: string): Log {
  return makeLog(module, []);
}

/* eslint-disable no-console -- the guard is the one place that reads and replaces console. */
const guardedMethods = ["log", "info", "debug", "warn", "error", "trace"] as const;

/**
 * JSON format only (main.ts). Saves the current console.log and console.error as the writer's sink, then replaces
 * console.log, info, debug, warn, error and trace with a function that writes the event console_output (level warn)
 * with the context fields and dropped_fields 1, and never its arguments. Returns a function that restores console.
 */
export function installConsoleGuard(): () => void {
  if (guardSink !== undefined) {
    throw new Error("console guard is on");
  }
  const saved = Object.fromEntries(guardedMethods.map((method) => [method, console[method]])) as Record<
    (typeof guardedMethods)[number],
    (...args: unknown[]) => void
  >;
  const sink = { log: saved.log, error: saved.error };
  guardSink = sink;
  // The guarded function reads no argument: a getter on an argument can throw or print.
  const guarded = (): void => {
    try {
      writeDropOnly("warn", "console", "console_output");
    } catch {
      // A guard must never throw into the code that called console.
    }
  };
  for (const method of guardedMethods) {
    console[method] = guarded;
  }
  return () => {
    if (guardSink !== sink) {
      return;
    }
    for (const method of guardedMethods) {
      console[method] = saved[method];
    }
    guardSink = undefined;
  };
}
/* eslint-enable no-console */
