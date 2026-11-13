import { format } from "node:util";

import { EVENT_CODE, isLogFieldName, isLogValue, type LogFields } from "./log-fields";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "text";
export type { LogFields } from "./log-fields";

export interface Log {
  debug(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  debug(...args: unknown[]): void;
  info(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  info(...args: unknown[]): void;
  warn(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  warn(...args: unknown[]): void;
  error(event: string, fields?: LogFields): void;
  /** @deprecated Free-text form; E8a converts the modules (ADR 0024). */
  error(...args: unknown[]): void;
}

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = "info";
let currentFormat: LogFormat | undefined;
let droppedTotal = 0;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setLogFormat(format: LogFormat): void {
  currentFormat = format;
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

const baseKeys: ReadonlySet<string> = new Set(["time", "level", "module", "event", "msg"]);

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
        if (isLogFieldName(key) && isLogValue(value) && !seen.has(key)) {
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

function write(level: LogLevel, module: string, args: readonly unknown[]): void {
  if (levelOrder[level] < levelOrder[currentLevel]) {
    return;
  }
  // eslint-disable-next-line no-console
  const out = level === "warn" || level === "error" ? console.error : console.log;
  const prefix = `[${module}]`;
  const asJson = resolveFormat() === "json";

  if (!isEventForm(args)) {
    if (!asJson) {
      out(prefix, ...args);
      return;
    }
    const line = {
      time: new Date().toISOString(),
      level,
      module,
      event: "legacy_text",
      msg: format(...args),
    };
    out(JSON.stringify(line));
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
  const dropped = addFields(pairs, [callFields]);
  if (dropped > 0) {
    pairs.push(["dropped_fields", dropped]);
    droppedTotal += dropped;
  }

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

export function createLog(module: string): Log {
  return {
    debug: (...args: unknown[]) => write("debug", module, args),
    info: (...args: unknown[]) => write("info", module, args),
    warn: (...args: unknown[]) => write("warn", module, args),
    error: (...args: unknown[]) => write("error", module, args),
  };
}
