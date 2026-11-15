import { randomBytes } from "node:crypto";

import { describe, expect, spyOn, test } from "bun:test";

import { actionsScope, sendScope } from "./composition";
import { loadConfig } from "./platform/config";

/** Every console line while `run` runs; the writer has already dropped a bad field, so `dropped_fields` must stay absent. */
function captureLines(run: () => void): string {
  const seen: string[] = [];
  const spies = (["log", "warn", "error"] as const).map((method) =>
    spyOn(console, method).mockImplementation((...args: unknown[]): void => {
      seen.push(args.join(" "));
    })
  );
  try {
    run();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  const output = seen.join("\n");
  expect(output).not.toContain("dropped_fields");
  return output;
}

const baseEnv = {
  DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/email_assistant",
  CREDENTIALS_KEY: randomBytes(32).toString("base64"),
  SEND_TEST_ADDRESSES: "me@x.test",
};
const configWith = (env: Record<string, string>) => loadConfig({ ...baseEnv, ...env });

describe("actionsScope writes one actions_scope event per scope", () => {
  for (const scope of ["off", "synthetic", "all"] as const) {
    test(`ACTIONS_SCOPE=${scope}`, () => {
      const output = captureLines(() => {
        expect(actionsScope(configWith({ ACTIONS_SCOPE: scope })).kind).toBe(scope);
      });
      expect(output).toContain(`actions_scope config_key=ACTIONS_SCOPE scope=${scope}`);
      expect(output).not.toContain("x.test");
    });
  }
});

describe("sendScope writes one send_scope event per scope", () => {
  for (const scope of ["off", "self", "all"] as const) {
    test(`SEND_SCOPE=${scope}`, () => {
      const output = captureLines(() => {
        expect(sendScope(configWith({ SEND_SCOPE: scope })).kind).toBe(scope);
      });
      expect(output).toContain(`send_scope config_key=SEND_SCOPE scope=${scope}`);
      expect(output).not.toContain("x.test");
    });
  }
});
