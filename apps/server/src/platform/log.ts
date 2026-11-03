export type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

type LogFn = (...args: unknown[]) => void;

export function createLog(module: string): Record<LogLevel, LogFn> {
  const prefix = `[${module}]`;
  const enabled = (level: LogLevel): boolean => levelOrder[level] >= levelOrder[currentLevel];

  return {
    debug: (...args) => {
      // eslint-disable-next-line no-console
      if (enabled("debug")) console.log(prefix, ...args);
    },
    info: (...args) => {
      // eslint-disable-next-line no-console
      if (enabled("info")) console.log(prefix, ...args);
    },
    warn: (...args) => {
      // eslint-disable-next-line no-console
      if (enabled("warn")) console.error(prefix, ...args);
    },
    error: (...args) => {
      // eslint-disable-next-line no-console
      if (enabled("error")) console.error(prefix, ...args);
    },
  };
}
