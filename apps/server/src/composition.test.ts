import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, spyOn, test } from "bun:test";

import { actionsScope, committerDeps, gateEvidenceDir, sendScope } from "./composition";
import { noLoopHooks } from "./modules/actions";
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

describe("the history job is wired in main.ts", () => {
  const main = read("main.ts");

  test("it is scheduled every 15 seconds, once, and only inside the block of the triage scope that is not off", () => {
    const start = main.indexOf("if (scope !== null) {");
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf("\n}\n", start);
    expect(main.slice(start, end)).toContain('scheduler.add("trust.history", "*/15 * * * * *"');
    expect(main.split('scheduler.add("trust.history"')).toHaveLength(2);
  });

  test("the shutdown waits for its run", () => {
    const start = main.indexOf("Promise.allSettled([");
    expect(start).toBeGreaterThan(-1);
    expect(main.slice(start, main.indexOf("])", start))).toContain("historyRun");
    expect(main).toContain("historyRun = history.run();");
  });
});

describe("the token store is wired into every composition root", () => {
  const main = read("main.ts");

  test("main.ts: the sync job and the committer deps get the shared tokens", () => {
    expect(callOf(main, "createMailSyncJob")).toContain("oauthTokens: mailOAuth.tokens");
    expect(callOf(main, "committerDeps")).toContain("oauthTokens: mailOAuth.tokens");
  });

  test("main.ts: the history job gets the shared tokens", () => {
    expect(callOf(main, "createHistoryJob")).toContain("oauthTokens: mailOAuth.tokens");
  });

  test("main.ts: the web Reconnect drops the same cache and uses the same clients", () => {
    const web = callOf(main, "webDeps");
    expect(web).toContain("mailOAuthLogin: { oauthTokens: mailOAuth.tokens }");
    expect(web).toContain("mailOAuthClients: mailOAuth.clients");
  });

  test("scripts/job-run.ts: the committer deps get a token store", () => {
    expect(callOf(read("scripts/job-run.ts"), "committerDeps")).toContain("oauthTokens:");
  });

  test("the history check is queued at every connect path: web form, OAuth callback and mailbox:connect", () => {
    const hook = "onConnected: queueHistoryCheckOnConnect(db)";
    const web = read("web.ts");
    expect(web.split(hook)).toHaveLength(3);
    expect(callOf(web, "mailRoutes")).toContain(hook);
    expect(callOf(web, "mailOAuthCallbackRoutes")).toContain(hook);
    expect(callOf(read("scripts/mailbox-connect.ts"), "connectMailbox")).toContain(hook);
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
        // `backfillMailbox` with the purpose `history`: its caller (the history job) passes `oauthTokens` from its composition root.
        "modules/mail/tools.ts",
        "scripts/job-run.ts",
      ]);
    })();
  });
});

// F116 stage 8: "Track my sent mail" off must close the open loops. A caller of `setSentSync` without the hook would
// leave them open with the texts of the deleted sent mail. The roots run at start, so the test reads the source.
describe("the sent switch hooks are wired into every caller of setSentSync", () => {
  test("every file outside the mail module that calls setSentSync passes sentSwitchHooks; the hook is onSentOff", () => {
    return (async () => {
      const callers: string[] = [];
      for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: import.meta.dir })) {
        if (file.endsWith(".test.ts") || file.startsWith("modules/mail/")) continue;
        const text = read(file);
        const call = /await\s+setSentSync\(/.exec(text);
        if (call === null) continue;
        callers.push(file);
        expect(callOf(text.slice(call.index), "setSentSync"), file).toContain("sentSwitchHooks");
      }
      expect(callers.sort()).toEqual(["scripts/mailbox-settings.ts", "web.ts"]);
      expect(read("composition.ts")).toContain("onDisabled: (trx, ctx, input) => onSentOff(trx, ctx, input)");
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

  // F116 stage 10: a committer without the loop hooks would find no follow-up loop open and send nothing for it. main.ts and
  // scripts/job-run.ts both build their deps here, so one check covers both roots.
  test("wires the real loop hooks, not the empty ones", () => {
    const deps = committerDeps({
      db: {} as Db,
      secrets: {} as SecretBox,
      oauthTokens: { accessToken: async () => "token", drop: () => undefined },
      scope: { kind: "off" },
      sendScope: { kind: "off" },
      sendLimits: { mailboxHour: 1, mailboxDay: 1, recipientDay: 1 },
    });
    expect(deps.loopHooks).toBeDefined();
    expect(deps.loopHooks).not.toBe(noLoopHooks);
    expect(typeof deps.loopHooks?.onFollowUpSent).toBe("function");
  });

  test("opens the Graph sender with the registry's Graph origin; the mail goes to no other URL", async () => {
    const oauthTokens: OAuthTokens = { accessToken: async () => "token", drop: () => undefined };
    const deps = committerDeps({
      db: {} as Db,
      secrets: {} as SecretBox,
      oauthTokens,
      scope: { kind: "off" },
      sendScope: { kind: "off" },
      sendLimits: { mailboxHour: 1, mailboxDay: 1, recipientDay: 1 },
    });
    // No network: `fetch` is a spy that answers 202.
    const urls: string[] = [];
    const answer = async (input: string | URL | Request): Promise<Response> => {
      urls.push(String(input));
      return new Response(null, { status: 202 });
    };
    const spy = spyOn(globalThis, "fetch").mockImplementation(answer as unknown as typeof fetch);
    try {
      const sender = await deps.openGraphSender?.({
        accessToken: "token",
        from: "a@x.test",
        freshToken: async () => "fresh",
      });
      await sender?.send({
        envelope: { from: "a@x.test", to: ["b@x.test"] },
        raw: Buffer.from("From: a@x.test\r\nTo: b@x.test\r\nSubject: s\r\n\r\nx\r\n"),
      });
    } finally {
      spy.mockRestore();
    }
    expect(urls).toEqual(["https://graph.microsoft.com/v1.0/me/sendMail"]);
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

// F110 stage 02: the server reads the gate files from `GATE_EVIDENCE_DIR`, default `evals/results/gate` of the repo.
describe("gateEvidenceDir", () => {
  test("the default folder holds the committed classifier gate files", () => {
    const dir = gateEvidenceDir(configWith({}));
    expect(readdirSync(dir).some((name) => name.startsWith("classifier-") && name.endsWith(".json"))).toBe(true);
  });

  test("GATE_EVIDENCE_DIR overrides it, and a relative path is a config error", () => {
    expect(gateEvidenceDir(configWith({ GATE_EVIDENCE_DIR: "/srv/gate" }))).toBe("/srv/gate");
    expect(gateEvidenceDir(configWith({ GATE_EVIDENCE_DIR: "" }))).toBe(gateEvidenceDir(configWith({})));
    expect(() => configWith({ GATE_EVIDENCE_DIR: "gate" })).toThrow();
  });
});

describe("the gate evidence is built once at start (F110 stage 02)", () => {
  const main = read("main.ts");

  test("main.ts reads the gate files once and hands the result to the web settings deps and the triage job", () => {
    expect(main.match(/gateEvidenceOf\(/g)).toHaveLength(1);
    expect(main).toContain("gateEvidenceOf(config, { table: llmTable })");
    expect(callOf(main, "webDeps")).toContain("gate,");
    expect(callOf(main, "createTriageJob")).toContain("runningKey: gate.runningKey");
  });

  test("only the composition builder reads the gate files; the CLI scripts use it too (no stricter than the API)", () => {
    expect(read("composition.ts").match(/loadGateEvidence\(/g)).toHaveLength(1);
    for (const script of ["scripts/mailbox-settings.ts", "scripts/lab.ts"]) {
      const text = read(script);
      expect(text).toContain("gateEvidenceOf(config, { quiet: true })");
      expect(text).not.toContain("loadGateEvidence(");
    }
  });

  test("the image copies the gate files to the path the reader defaults to", () => {
    const dockerfile = readFileSync(join(import.meta.dir, "../../../deploy/Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY evals/results/gate evals/results/gate\n");
  });

  test("the web passes the gate to the one settings deps builder", () => {
    expect(callOf(read("web.ts"), "settingsDeps")).toContain("gate");
  });
});
