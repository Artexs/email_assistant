/** Output of a CLI script for the operator's terminal. Not a log line: no LOG_FORMAT, no level, no allow-list (docs/code-patterns.md § Logs). Only apps/server/src/scripts/ imports it. */
export interface CliOutput {
  /** `[name] text` on stdout. */
  print(text: string): void;
  /** `[name] text` on stderr. */
  fail(text: string): void;
}

export function createCliOutput(name: string): CliOutput {
  const prefix = `[${name}]`;
  return {
    print(text) {
      // eslint-disable-next-line no-console
      console.log(prefix, text);
    },
    fail(text) {
      // eslint-disable-next-line no-console
      console.error(prefix, text);
    },
  };
}
