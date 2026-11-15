import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, spyOn, test } from "bun:test";

import { actionsScope, committerDeps, sendScope } from "./composition";
import type { OAuthTokens } from "./modules/mail";
import { loadConfig } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { Db } from "./platform/db";

// F117 stage 10: every composition root that opens mailboxes (the sync job, the committer, the web Reconnect) gets the token store.
// A call without it would fail every OAuth mailbox with "oauth not wired", or leave a Reconnect without a cache drop. The
// composition roots run at start, so the test reads their source: the text between the parentheses of each call.
const read = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");

/** The text between the parentheses of the first call of `name`. */
function callOf(source: string, name: string): string {
  const start = source.indexOf(`${name}(`);
  if (start === -1) throw new Error(`no call of ${name}`);
  let depth = 0;
  for (let index = start + name.length; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`call of ${name} does not end`);
}

describe("the token store is wired into every composition root", () => {
  const main = read("main.ts");

  test("main.ts: the sync job and the committer deps get the shared tokens", () => {
    expect(callOf(main, "createMailSyncJob")).toContain("oauthTokens: mailOAuth.tokens");
    expect(callOf(main, "committerDeps")).toContain("oauthTokens: mailOAuth.tokens");
  });

  test("main.ts: the web Reconnect drops the same cache and uses the same clients", () => {
    const web = callOf(main, "webDeps");
    expect(web).toContain("mailOAuthLogin: { oauthTokens: mailOAuth.tokens }");
    expect(web).toContain("mailOAuthClients: mailOAuth.clients");
  });

  test("scripts/job-run.ts: the committer deps get a token store", () => {
    expect(callOf(read("scripts/job-run.ts"), "committerDeps")).toContain("oauthTokens:");
  });

  test("no other file builds a sync job or committer deps without being listed here", () => {
    const files = new Bun.Glob("**/*.ts").scan({ cwd: import.meta.dir });
    return (async () => {
      const callers: string[] = [];
      for await (const file of files) {
        if (file.endsWith(".test.ts")) continue;
        const text = read(file);
        if (/\b(?:createMailSyncJob|committerDeps|openMailboxProvider)\(/.test(text)) callers.push(file);
      }
      expect(callers.sort()).toEqual([
        "composition.ts",
        "main.ts",
        "modules/actions/committer.ts",
        "modules/mail/jobs.ts",
        "modules/mail/open.ts",
        "scripts/job-run.ts",
      ]);
    })();
  });
});

describe("committerDeps", () => {
  test("passes the token store on to the committer", () => {
    const oauthTokens: OAuthTokens = { accessToken: async () => "token", drop: () => undefined };
    const deps = committerDeps({
      db: {} as Db,
      secrets: {} as SecretBox,
      oauthTokens,
      scope: { kind: "off" },
      sendScope: { kind: "off" },
      sendLimits: { mailboxHour: 1, mailboxDay: 1, recipientDay: 1 },
    });
    expect(deps.oauthTokens).toBe(oauthTokens);
  });
});

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
