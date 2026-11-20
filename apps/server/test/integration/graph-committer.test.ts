import { randomBytes, randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { DEFAULT_SEND_LIMITS, type SendLimits, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import { committerDeps } from "../../src/composition";
import { createCommitterJob, type SendScope } from "../../src/modules/actions";
import {
  createMailOAuthClients,
  createOAuthTokens,
  openImapProvider,
  type MailOAuthClients,
  type OAuthTokens,
} from "../../src/modules/mail";
import { appendRaw } from "../../src/modules/mail/imap/tools";
import { encodeOAuthSecret } from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { logFormatFromEnv, setLogFormat, setLogLevel } from "../../src/platform/log";
import { startFakeGraph, type FakeGraph } from "../fake-graph";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { insertDraftAndSend, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { webOrg, type WebOrg } from "./web-helpers";

// The committer sends the mail of a Microsoft mailbox through Graph. IMAP is the local GreenMail (auth off: a login with
// a new user makes the mailbox, XOAUTH2 takes any token), the token endpoint is the fake token server, Graph is the fake of this test.
// The mail goes to the fake Graph server only; test addresses end in `@x.test`. The job is the real `committerDeps` composition.
// Rows are committed: the token store runs its own transactions on the pool. The committer finds the mailboxes of the whole database;
// a mailbox without a claimable action is never opened.
const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const VERIFIER = "v".repeat(43);
const IMAP_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const IMAP_PORT = Number(process.env.TEST_IMAP_PORT ?? "3143");
const SMTP_PORT = Number(process.env.TEST_SMTP_PORT ?? "3025");

let oauth: FakeMailOAuth;
let graph: FakeGraph;
let clients: MailOAuthClients;
let tokens: OAuthTokens;
let org: WebOrg;
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

const ctxA = () => ({ orgId: org.orgId });
const ctxB = () => ({ orgId: org.otherOrgId });

beforeAll(async () => {
  oauth = await startFakeMailOAuth();
  graph = await startFakeGraph();
  const config = loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: "http://127.0.0.1:8081",
    WEB_AUTH_SECRET: "x".repeat(32),
    MAIL_OAUTH_MICROSOFT_CLIENT_ID: oauth.clientId,
    MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: oauth.clientSecret,
  });
  clients = createMailOAuthClients(config, {
    specs: oauth.specs({
      imap: { host: IMAP_HOST, port: IMAP_PORT },
      smtp: { host: IMAP_HOST, port: SMTP_PORT, security: "tls" },
      graphBaseUrl: graph.baseUrl,
    }),
  });
  tokens = createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() });
});

afterAll(async () => {
  await oauth.stop();
  await graph.stop();
  await db.destroy();
});

beforeEach(async () => {
  org = await webOrg(db);
  graph.calls.length = 0;
  graph.sent.length = 0;
  oauth.calls.length = 0;
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    logSpies.push(
      spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logLines.push(format(...args));
      }) as unknown as Mock<(...args: unknown[]) => void>
    );
  }
  setLogFormat("json");
  setLogLevel("debug");
});

afterEach(async () => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  setLogFormat(logFormatFromEnv(process.env));
  await org.cleanup();
});

interface Box {
  id: string;
  orgId: string;
  address: string;
  refreshToken: string;
}

/** A Microsoft mailbox on GreenMail with an `oauth` secret that the fake token server knows, and `send_via = 'graph'`. */
async function seedMailbox(orgId: string): Promise<Box> {
  const id = randomUUID();
  const address = `u-${randomUUID()}@localhost`;
  const client = clients.microsoft;
  if (client === undefined) throw new Error("no client");
  const answer = await client.redeemCode(oauth.code({ provider: "microsoft", address }), VERIFIER);
  const refreshToken = answer.refreshToken ?? "";
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: IMAP_HOST,
      imapPort: IMAP_PORT,
      smtpHost: IMAP_HOST,
      smtpPort: SMTP_PORT,
      capabilities: testCapabilities,
      folderMap: {},
      oauthProvider: "microsoft",
      sendVia: "graph",
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  const sealed = secrets.encrypt(
    encodeOAuthSecret({ v: 1, provider: "microsoft", refreshToken, tenantId: null, scopes: ["old-scope"] }),
    `mailbox:${id}`
  );
  await insertCredentials(
    db,
    { orgId },
    { mailboxId: id, encryptedSecret: sealed.ciphertext, secretKind: "oauth", keyVersion: sealed.keyVersion }
  );
  oauth.calls.length = 0;
  return { id, orgId, address, refreshToken };
}

interface Send {
  draftId: string;
  sendId: string;
  to: string;
}

/** An approved delegation: the draft is applied, the send waits for the committer. */
async function seedSend(box: Box, over: { approved?: boolean; to?: string } = {}): Promise<Send> {
  const to = over.to ?? `delegate-${randomUUID()}@x.test`;
  const userId = box.orgId === org.orgId ? org.ownerId : org.otherOwnerId;
  const { draftId, sendId } = await db.transaction().execute((trx) =>
    insertDraftAndSend(trx, { orgId: box.orgId }, box.id, {
      to,
      createdAt: new Date(Date.now() - 30 * MINUTE_MS),
      draftStatus: "applied",
      draftProviderResult: { uid: 1, folder: "Drafts" },
      sendStatus: over.approved === false ? "awaiting_approval" : "approved",
      ...(over.approved === false ? {} : { approved: { userId, at: new Date(Date.now() - MINUTE_MS) } }),
      subject: "Graph canary subject",
      task: "graph-canary-task-text",
    })
  );
  return { draftId, sendId, to };
}

interface Run {
  waits: number[];
  /** Runs before each look for the Sent copy after the first (the wait). */
  beforeLook?: () => Promise<void>;
  sendScope?: SendScope;
  sendLimits?: SendLimits;
}

/** One committer run with the real composition (`committerDeps`) and a fake wait. */
async function runCommitter(run: Run = { waits: [] }): Promise<void> {
  const deps = committerDeps({
    db,
    secrets,
    oauthTokens: tokens,
    scope: { kind: "all" },
    sendScope: run.sendScope ?? { kind: "all" },
    sendLimits: run.sendLimits ?? DEFAULT_SEND_LIMITS,
    graphBaseUrl: graph.baseUrl,
  });
  await createCommitterJob({
    ...deps,
    sleep: async (ms) => {
      run.waits.push(ms);
      await run.beforeLook?.();
    },
  }).run();
}

const actionOf = (id: string) => db.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const mailboxOf = (id: string) => db.selectFrom("mailboxes").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

async function sentFolderOf(box: Box): Promise<number> {
  const reader = await openImapProvider({
    host: IMAP_HOST,
    port: IMAP_PORT,
    user: box.address,
    auth: { kind: "password", password: "reader" },
  });
  try {
    return (await reader.searchSinceIn("Sent", new Date(0))).length;
  } finally {
    await reader.close();
  }
}

describe("a Microsoft mailbox sends through Graph", () => {
  test("8. an approved delegation: one Graph call with the action's Message-ID and X-EA-Action-Id; applied; one send start", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);

    await runCommitter({ waits: [] });

    expect(graph.calls).toHaveLength(1);
    const row = await actionOf(send.sendId);
    expect(row.status).toBe("applied");
    expect(row.send_started_at).not.toBeNull();
    const raw = graph.calls[0]?.raw.toString("utf8") ?? "";
    // nodemailer writes the header as `X-Ea-Action-ID`; header names are case-insensitive.
    expect(raw.toLowerCase()).toContain(`x-ea-action-id: ${send.draftId}`);
    expect(raw).toContain(`Message-ID: ${(row.provider_result as { message_id?: string }).message_id}`);
    expect(raw).toContain(`<${send.to}>`);
    expect(raw).toContain(`<${box.address}>`);
    expect(row.provider_result).toMatchObject({ response: "202 Accepted", accepted: 1 });
    // The token is the Graph one: the token endpoint saw a refresh with the Graph scope, and Graph got that access token.
    const scopes = oauth.calls.filter((call) => call.grant === "refresh_token").map((call) => call.scope ?? "");
    expect(scopes.some((scope) => scope.includes("graph.microsoft.com/Mail.Send"))).toBe(true);
    expect(graph.calls[0]?.authorization).toMatch(/^Bearer at-/);
  });

  test("8b. a second run sends nothing again", async () => {
    const box = await seedMailbox(org.orgId);
    await seedSend(box);
    await runCommitter({ waits: [] });
    await runCommitter({ waits: [] });
    expect(graph.calls).toHaveLength(1);
  });

  test("9. Graph answers 500: the action is not resent at the next committer tick", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);
    graph.respondNext(500, { error: { code: "InternalServerError" } });

    await runCommitter({ waits: [] });
    const row = await actionOf(send.sendId);
    expect(row).toMatchObject({ status: "failed", status_reason: "outcome_unknown" });
    // The send counts against the limits: its start is stored.
    expect(row.send_started_at).not.toBeNull();

    await runCommitter({ waits: [] });
    expect(graph.calls).toHaveLength(1);
    expect((await actionOf(send.sendId)).status).toBe("failed");
  });

  test("10. Graph answers 403 ErrorAccessDenied: the mailbox is auth_error / admin_consent_required; the send waits as approved", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);
    graph.respondNext(403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } });

    await runCommitter({ waits: [] });

    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: "admin_consent_required" });
    expect(await actionOf(send.sendId)).toMatchObject({ status: "approved", locked_at: null });
    // The mailbox is not `active`: the next run does not call Graph.
    await runCommitter({ waits: [] });
    expect(graph.calls).toHaveLength(1);
  });

  test("10b. 403 with another code: protocol_disabled; 401 twice: oauth_revoked", async () => {
    const first = await seedMailbox(org.orgId);
    await seedSend(first);
    graph.respondNext(403, { error: { code: "MailboxNotEnabledForRESTAPI" } });
    await runCommitter({ waits: [] });
    expect(await mailboxOf(first.id)).toMatchObject({ status: "auth_error", auth_reason: "protocol_disabled" });

    const second = await seedMailbox(org.orgId);
    await seedSend(second);
    graph.respondNext(401);
    graph.respondNext(401);
    const before = graph.calls.length;
    await runCommitter({ waits: [] });
    expect(graph.calls.length - before).toBe(2);
    expect(await mailboxOf(second.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_revoked" });
  });

  test("10c. 401, then 202: a fresh Graph token is used and the mail goes out once", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);
    graph.respondNext(401);

    await runCommitter({ waits: [] });

    expect(graph.calls).toHaveLength(2);
    expect(graph.calls[0]?.authorization).not.toBe(graph.calls[1]?.authorization);
    expect(graph.sent).toHaveLength(1);
    expect((await actionOf(send.sendId)).status).toBe("applied");
    expect((await mailboxOf(box.id)).status).toBe("active");
  });
});

describe("the Sent copy of a Graph send", () => {
  test("11a. no copy appears: no APPEND, three looks (waits 5 s and 10 s), sent_copy provider", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);
    const run: Run = { waits: [] };

    await runCommitter(run);

    expect(run.waits).toEqual([5_000, 10_000]);
    const row = await actionOf(send.sendId);
    expect(row.status).toBe("applied");
    expect(row.provider_result).toMatchObject({ sent_copy: "provider" });
    expect(await sentFolderOf(box)).toBe(0);
  });

  test("11b. a copy that Graph saves before the second look is found: sent_copy found, one wait, still no APPEND by the system", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);
    const run: Run = {
      waits: [],
      async beforeLook() {
        // What Graph does a few seconds after the 202: the sent message appears in Sent.
        await appendRaw(
          { host: IMAP_HOST, port: IMAP_PORT, user: box.address, auth: { kind: "password", password: "reader" } },
          "Sent",
          (graph.sent[0]?.raw ?? Buffer.alloc(0)).toString("latin1"),
          ["\\Seen"]
        );
      },
    };

    await runCommitter(run);

    expect(run.waits).toEqual([5_000]);
    expect((await actionOf(send.sendId)).provider_result).toMatchObject({ sent_copy: "found" });
    // The one copy is the test's; the system added none.
    expect(await sentFolderOf(box)).toBe(1);
  });
});

describe("the send path keeps the rules of the actions service", () => {
  test("a send that nobody approved does not go out", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box, { approved: false });
    await runCommitter({ waits: [] });
    expect(graph.calls).toHaveLength(0);
    expect((await actionOf(send.sendId)).status).toBe("awaiting_approval");
  });

  test("SEND_SCOPE off: no Graph call; the send waits as approved", async () => {
    const box = await seedMailbox(org.orgId);
    const send = await seedSend(box);
    await runCommitter({ waits: [], sendScope: { kind: "off" } });
    expect(graph.calls).toHaveLength(0);
    expect((await actionOf(send.sendId)).status).toBe("approved");
  });

  test("SEND_SCOPE self: only a listed recipient goes out", async () => {
    const box = await seedMailbox(org.orgId);
    const listed = await seedSend(box, { to: "listed@x.test" });
    const other = await seedSend(box, { to: "other@x.test" });
    await runCommitter({ waits: [], sendScope: { kind: "self", addresses: ["listed@x.test"] } });
    expect(graph.calls).toHaveLength(1);
    expect(graph.calls[0]?.raw.toString("utf8")).toContain("<listed@x.test>");
    expect((await actionOf(listed.sendId)).status).toBe("applied");
    expect((await actionOf(other.sendId)).status).toBe("approved");
  });

  test("the send limits hold a second send of the hour: one Graph call", async () => {
    const box = await seedMailbox(org.orgId);
    const first = await seedSend(box);
    const second = await seedSend(box);
    await runCommitter({ waits: [], sendLimits: { ...DEFAULT_SEND_LIMITS, mailboxHour: 1 } });
    expect(graph.calls).toHaveLength(1);
    const states = [(await actionOf(first.sendId)).status, (await actionOf(second.sendId)).status].sort();
    expect(states).toEqual(["applied", "approved"]);
  });

  test("two organizations: each mail goes out from its own mailbox with its own token; nothing crosses", async () => {
    const boxA = await seedMailbox(ctxA().orgId);
    const boxB = await seedMailbox(ctxB().orgId);
    const sendA = await seedSend(boxA, { to: "a-delegate@x.test" });
    const sendB = await seedSend(boxB, { to: "b-delegate@x.test" });

    await runCommitter({ waits: [] });

    expect(graph.calls).toHaveLength(2);
    const byTo = (to: string) => graph.calls.find((call) => call.raw.toString("utf8").includes(`<${to}>`));
    const callA = byTo("a-delegate@x.test");
    const callB = byTo("b-delegate@x.test");
    expect(callA?.raw.toString("utf8")).toContain(boxA.address);
    expect(callA?.raw.toString("utf8")).not.toContain(boxB.address);
    expect(callB?.raw.toString("utf8")).toContain(boxB.address);
    expect(callB?.raw.toString("utf8")).not.toContain(boxA.address);
    expect(callA?.authorization).not.toBe(callB?.authorization);
    expect((await actionOf(sendA.sendId)).org_id).toBe(boxA.orgId);
    expect((await actionOf(sendB.sendId)).status).toBe("applied");
    // A refusal for one organization does not touch the other organization's mailbox.
    const failA = await seedSend(boxA);
    await seedSend(boxB);
    graph.respondNext(403, { error: { code: "ErrorAccessDenied" } });
    await runCommitter({ waits: [] });
    const states = [(await mailboxOf(boxA.id)).status, (await mailboxOf(boxB.id)).status].sort();
    expect(states).toEqual(["active", "auth_error"]);
    expect(failA.sendId).toBeDefined();
  });
});

describe("12. canary: no token or mail text in a log line, a row or an error", () => {
  test("access tokens, refresh tokens and the mail text stay out of logs, action rows, audit rows and the mailbox row", async () => {
    const box = await seedMailbox(org.orgId);
    const ok = await seedSend(box);
    await runCommitter({ waits: [] });
    const failing = await seedSend(box);
    graph.respondNext(500, { error: { code: "InternalServerError", message: "graph-canary-task-text secret" } });
    await runCommitter({ waits: [] });
    const refused = await seedSend(box);
    graph.respondNext(403, { error: { code: "ErrorAccessDenied", message: "graph-canary-task-text secret" } });
    await runCommitter({ waits: [] });

    const tokensSeen = [
      ...graph.calls.map((call) => call.authorization.replace("Bearer ", "")),
      ...oauth.issuedRefreshTokens,
      box.refreshToken,
    ];
    expect(tokensSeen.length).toBeGreaterThan(3);
    const actions = await db.selectFrom("actions").selectAll().where("org_id", "=", org.orgId).execute();
    const audit = await db.selectFrom("audit_log").selectAll().where("org_id", "=", org.orgId).execute();
    const mailbox = await db.selectFrom("mailboxes").selectAll().where("id", "=", box.id).execute();
    // The action payload holds the task text by design; the other columns never do.
    const results = actions.map((row) => [row.provider_result, row.last_error, row.status_reason]);
    const everything = [...logLines, inspect([actions, audit, mailbox], { depth: 8 })].join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    for (const secret of [...tokensSeen, oauth.clientSecret, "Bearer at-"]) {
      expect(everything).not.toContain(secret);
    }
    const noMailText = [...logLines, inspect([audit, mailbox, results], { depth: 8 })].join("\n");
    for (const text of ["graph-canary-task-text", "Graph canary subject", "Access is denied", "dropped_fields"]) {
      expect(noMailText).not.toContain(text);
    }
    expect([ok.sendId, failing.sendId, refused.sendId]).toHaveLength(3);
  });
});
