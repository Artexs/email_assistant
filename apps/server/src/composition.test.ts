import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_SEND_LIMITS } from "@ea/core";
import { describe, expect, spyOn, test } from "bun:test";

import { actionsScope, committerDeps, gateEvidenceDir, gateEvidenceOf, sendScope } from "./composition";
import { noApprovalHooks, noLoopHooks } from "./modules/actions";
import { type OAuthTokens, openImapProvider, type openMailboxProvider } from "./modules/mail";
import { loadConfig, testMailRule } from "./platform/config";
import type { SecretBox } from "./platform/crypto";
import type { Db } from "./platform/db";
import { jobRunCommitterDeps } from "./scripts/job-run";
import { checkCopyDeps } from "./scripts/reply-check-copy";
import { startSource } from "./start/source.test-helper";
import { settingsRouteDeps } from "./web-route-deps";

// Every composition root that opens mailboxes (the sync job, the committer, the web Reconnect) gets the token store.
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
  const main = startSource();

  test("it is scheduled every 15 seconds, once, and only inside the block of the triage scope that is not off", () => {
    const start = main.indexOf("if (scope !== null) {");
    expect(start).toBeGreaterThan(-1);
    const end = main.indexOf("\n}\n", start);
    expect(main.slice(start, end)).toContain('scheduler.add("trust.history", "*/15 * * * * *"');
    expect(main.split('scheduler.add("trust.history"')).toHaveLength(2);
  });

  test("the shutdown waits for its run", () => {
    expect(main).toContain('runs.track("trust.history", () => history.run())');
  });
});

describe("the triage job gets the profile reader in main.ts (F120 stage 11)", () => {
  const main = startSource();

  test("createTriageJob gets readProfile from senderProfileReader with the credentials key", () => {
    const start = main.indexOf("createTriageJob({");
    expect(start).toBeGreaterThan(-1);
    expect(main.split("createTriageJob({")).toHaveLength(2);
    const call = main.slice(start, main.indexOf("\n  });", start));
    expect(call).toContain("readProfile: senderProfileReader({ db, credentialsKey: config.CREDENTIALS_KEY,");
  });
});

describe("the sender profile job is wired in main.ts", () => {
  const main = startSource();

  test("it runs hourly at minute 7 (six fields: second 0), once, outside the block of the triage scope", () => {
    expect(main).toContain('scheduler.add("contacts.refresh", "0 7 * * * *"');
    expect(main.split('scheduler.add("contacts.refresh"')).toHaveLength(2);
    const scopeStart = main.indexOf("if (scope !== null) {");
    expect(scopeStart).toBeGreaterThan(-1);
    const scopeEnd = main.indexOf("\n}\n", scopeStart);
    const at = main.indexOf('scheduler.add("contacts.refresh"');
    expect(at < scopeStart || at > scopeEnd).toBe(true);
  });

  test("the shutdown waits for its run", () => {
    expect(main).toContain('runs.track("contacts.refresh", () => contactsRefresh.run()');
  });
});

// ADR 0022 point 2: report mail is the system's own mail, so every caller of the sync, the backfill and the history run
// passes the composed own-mail check. A root that passed `isOwnActionId` alone would store, triage and sample the report mail.
describe("the own-mail check is composed in every root (F110 stage 20)", () => {
  test("main.ts: the sync job and the history job get isOwnMailOf; the CLI backfill too", () => {
    const main = startSource();
    expect(callOf(main, "createMailSyncJob")).toContain("isOwnActionId: isOwnMailOf(db)");
    expect(callOf(main, "createHistoryJob")).toContain("isOwnActionId: isOwnMailOf(db)");
    expect(callOf(read("scripts/mailbox-backfill.ts"), "backfillMailbox")).toContain("isOwnActionId: isOwnMailOf(db)");
  });

  test("no file outside the modules passes a sync dependency that is not the composed check", () => {
    return (async () => {
      const found: string[] = [];
      for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: import.meta.dir })) {
        if (file.endsWith(".test.ts") || file.startsWith("modules/")) continue;
        const text = read(file);
        for (const match of text.matchAll(/isOwnActionId:\s*([^\n,}]*)/g)) {
          found.push(`${file}: ${match[1]?.trim()}`);
        }
      }
      expect(found.sort()).toEqual([
        "scripts/mailbox-backfill.ts: isOwnMailOf(db)",
        "start/mail.ts: isOwnMailOf(db)",
        "start/triage.ts: isOwnMailOf(db)",
      ]);
    })();
  });

  test("isOwnMailOf is the draft check or the report mail check", () => {
    const text = read("composition.ts");
    expect(text).toContain(
      "(await isOwnActionId(db, ctx, mailboxId, id)) || (await isOwnReportMail(db, ctx, mailboxId, id))"
    );
  });
});

// Two sentences of the docs were wrong (the report mail is not "the only write to INBOX": the spam rescue and own sends land
// there too; the header id is an outbox row, not an action row).
describe("the docs say what the report mail does (F110 stage 20 review)", () => {
  const root = join(import.meta.dir, "../../..");

  test("architecture: the only APPEND into INBOX, not the only write", () => {
    const text = readFileSync(join(root, "docs/architecture.md"), "utf8");
    expect(text).toContain("Report mail is the only APPEND into INBOX");
    expect(text).not.toContain("only write to INBOX");
  });

  test("ADR 0022 point 2 names an outbox row, not an action row", () => {
    const text = readFileSync(join(root, "docs/decisions/0022-report-mail-into-own-inbox.md"), "utf8");
    expect(text).toContain("the id of an outbox row of the channel `mail`");
    expect(text).not.toContain("id of an action row");
  });
});

describe("the push sender is wired in main.ts (F118 stage 08)", () => {
  const main = startSource();

  test("it is scheduled every 15 seconds, once, only with the VAPID keys, outside the Telegram block, and the shutdown waits for its run", () => {
    expect(main.split('scheduler.add("channels.push", "*/15 * * * * *"')).toHaveLength(2);
    expect(main).toContain('runs.track("channels.push", () => pushSender.run())');
    expect(main).toContain("const pushKeys = pushConfigOf(config);");
    // A push-only member needs no bot: the job sits before `if (config.TELEGRAM_BOT_TOKEN === undefined) {`.
    const telegramBlock = main.indexOf("if (config.TELEGRAM_BOT_TOKEN === undefined) {");
    expect(main.indexOf('scheduler.add("channels.push"')).toBeLessThan(telegramBlock);
    // No keys, no job: the scheduler call sits in the `else` of the null check.
    expect(main.indexOf("if (pushKeys === null) {")).toBeLessThan(main.indexOf('scheduler.add("channels.push"'));
  });

  test("the sender gets the box, the keys, the global fetch and the clock", () => {
    const call = callOf(main, "createPushSender");
    expect(call).toContain("box: secrets");
    expect(call).toContain("keys: pushKeys");
    expect(call).toContain("fetch,");
  });
});

describe("the report mail sender is wired in main.ts (F110 stage 20)", () => {
  const main = startSource();

  test("it is scheduled every 15 seconds, once, outside the Telegram block, and the shutdown waits for its run", () => {
    expect(main.split('scheduler.add("channels.report_mail", "*/15 * * * * *"')).toHaveLength(2);
    expect(main).toContain('runs.track("channels.report_mail", () => reportMail.run())');
    // Not inside `if (config.TELEGRAM_BOT_TOKEN === undefined) { ... } else { ... }`: a mail-only member needs no bot.
    const telegramBlock = main.indexOf("if (config.TELEGRAM_BOT_TOKEN === undefined) {");
    expect(main.indexOf('scheduler.add("channels.report_mail"')).toBeLessThan(telegramBlock);
  });

  test("the sender gets WEB_BASE_URL: without it the mail has no link (review TG2)", () => {
    expect(callOf(main, "createReportMailSender")).toContain("webBaseUrl: config.WEB_BASE_URL");
  });

  test("the sender gets the IMAP adapter with the shared tokens and no SMTP sender", () => {
    const call = callOf(main, "createImapReportMailbox");
    expect(call).toContain("oauthTokens: mailOAuth.tokens");
    expect(call).not.toMatch(/smtp|openSender|Graph/i);
  });
});

describe("the tripwire job is wired in main.ts", () => {
  const main = startSource();

  test("it is scheduled every minute, once, and outside the block of the triage scope (it calls no model)", () => {
    const start = main.indexOf("if (scope !== null) {");
    const end = main.indexOf("\n}\n", start);
    expect(main.slice(start, end)).not.toContain("trust.tripwire");
    expect(main).toContain('scheduler.add("trust.tripwire", "0 * * * * *"');
    expect(main.split('scheduler.add("trust.tripwire"')).toHaveLength(2);
  });

  test("it gets the settings deps with the gate evidence of the running classifier, and the shutdown waits for its run", () => {
    expect(callOf(main, "createTripwireJob")).toContain("settingsDeps(db, () => new Date(), gate)");
    expect(main).toContain('runs.track("trust.tripwire", () => tripwire.run())');
  });
});

describe("the token store is wired into every composition root", () => {
  const main = startSource();

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

  test("committerDeps carries the real approval hooks: a send that the committer closes edits its cards", () => {
    const deps = committerDeps({
      db: {} as never,
      secrets: {} as never,
      oauthTokens: {} as never,
      scope: { kind: "off" },
      sendScope: { kind: "off" },
      sendLimits: DEFAULT_SEND_LIMITS,
    });
    expect(deps.approvalHooks).toBeDefined();
    expect(deps.approvalHooks).not.toBe(noApprovalHooks);
  });

  test("the history check is queued at every connect path: web form, OAuth callback and mailbox:connect", () => {
    const hook = "onConnected: queueHistoryCheckOnConnect(db)";
    const web = read("web-routers.ts");
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
        "modules/actions/committer.ts",
        // The report mail adapter opens the mailbox for an APPEND into its INBOX; it passes no sender.
        "modules/channels/report-mailbox-imap.ts",
        "modules/mail/jobs.ts",
        "modules/mail/open.ts",
        // `backfillMailbox` with the purpose `history`: its caller (the history job) passes `oauthTokens` from its composition root.
        "modules/mail/tools.ts",
        "scripts/job-run.ts",
        // The copy probe opens the mailbox of one draft with the shared opener and a token store.
        "scripts/reply-check-copy.ts",
        "start/jobs.ts",
        "start/mail.ts",
      ]);
    })();
  });
});

// "Track my sent mail" off must close the open loops. A caller of `setSentSync` without the hook would
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
      expect(callers.sort()).toEqual(["scripts/mailbox-settings.ts", "web-route-deps.ts"]);
      // The hook closes the loops (`onSentOff`) and then clears the follow-up cards (`clearLoopCards`), in one transaction.
      const wiring = read("composition.ts");
      expect(wiring).toContain("await onSentOff(trx, ctx, input);");
      expect(wiring).toContain("await clearLoopCards(trx, ctx, input);");
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

  // A committer without the loop hooks would find no follow-up loop open and send nothing for it. main.ts and
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

describe("the CLI scripts and the web hand their shared parts to the deps they build", () => {
  test("scripts/job-run.ts: the committer deps get a token store", () => {
    const deps = jobRunCommitterDeps(configWith({}), {} as never);
    expect(typeof deps.oauthTokens?.accessToken).toBe("function");
  });

  test("scripts/reply-check-copy.ts: the mailbox opener gets a token store", async () => {
    const provider = { kind: "provider" };
    const seen: Parameters<typeof openMailboxProvider>[] = [];
    const spy = (async (...args: Parameters<typeof openMailboxProvider>) => {
      seen.push(args);
      return { provider };
    }) as unknown as typeof openMailboxProvider;

    const deps = checkCopyDeps(configWith({}), {} as never, spy);

    expect(await deps.openProvider({ orgId: "org-1" }, "mb-1")).toBe(provider as never);
    expect(seen).toHaveLength(1);
    const [openDeps, ctx, mailboxId] = seen[0] as Parameters<typeof openMailboxProvider>;
    expect(typeof openDeps.oauthTokens?.accessToken).toBe("function");
    expect(openDeps.openProvider).toBe(openImapProvider);
    expect(ctx).toEqual({ orgId: "org-1" });
    expect(mailboxId).toBe("mb-1");
  });

  test("the web passes the gate to the one settings deps builder", () => {
    const config = configWith({});
    const gate = gateEvidenceOf(config, { quiet: true });

    const deps = settingsRouteDeps({} as never, () => new Date("2026-01-01T00:00:00Z"), testMailRule(config), gate);

    expect(deps.settings.gate).toBe(gate);
  });
});

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

// The server reads the gate files from `GATE_EVIDENCE_DIR`, default `evals/results/gate` of the repo.
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
  const main = startSource();

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

  test("the web mounts the trust routes with the settings deps of the same gate and the test mail rule", () => {
    const call = callOf(read("web-routers.ts"), "trustRoutes");
    expect(call).toContain("settingsDeps(db, now, extras.gate)");
    expect(call).toContain("testMail: testMailRule(config)");
  });
});
