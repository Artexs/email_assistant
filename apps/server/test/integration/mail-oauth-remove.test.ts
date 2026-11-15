import { randomBytes, randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { removeMailboxResultSchema, textTables } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { sql } from "kysely";

import {
  createMailOAuthClients,
  removeMailbox,
  type MailOAuthClients,
  type MailOAuthProvider,
  type RemoveDeps,
} from "../../src/modules/mail";
import { OAUTH_TIMEOUT_MS } from "../../src/modules/mail/oauth/client";
import { MICROSOFT_PERSONAL_TENANT } from "../../src/modules/mail/oauth/revoke";
import { encodeOAuthSecret, saveOAuthSecret, withMailboxOAuthLock } from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { apiRouters, type WebExtras } from "../../src/web";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { linkChat, randomChatId, renderedOf, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, noPrivacy, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// F117 stage 12: Remove of an OAuth mailbox. Google: the token is revoked after the delete commits. Microsoft: no call; the notice
// names the page. The token endpoint is the fake of stage 06. Rows are committed, because Remove runs its own transactions on the pool.
// No real provider call. The canary: the refresh token is in no log line, answer, notice or audit row.
const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const VERIFIER = "v".repeat(43);
const WORK_TENANT = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-15T10:00:00Z");
const HOSTS = {
  imap: { host: "127.0.0.1", port: 3143 },
  smtp: { host: "127.0.0.1", port: 3025, security: "tls" as const },
};

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];
const dropped: string[] = [];
/** Per call of `revoke`: did the mailbox row still exist at that moment? (the revoke runs after the commit). */
const revokeSaw: { mailboxRows: number }[] = [];
let revokeCalls = 0;

const testConfig = () =>
  loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: "http://127.0.0.1:8080",
    WEB_AUTH_SECRET: "x".repeat(32),
    MAIL_OAUTH_MICROSOFT_CLIENT_ID: fake.clientId,
    MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: fake.clientSecret,
    MAIL_OAUTH_GOOGLE_CLIENT_ID: fake.clientId,
    MAIL_OAUTH_GOOGLE_CLIENT_SECRET: fake.clientSecret,
  });

/** The real clients with a wrapper on `revoke` that counts the calls and reads the mailbox table at call time. */
function watched(real: MailOAuthClients): MailOAuthClients {
  const out: MailOAuthClients = {};
  for (const provider of ["microsoft", "google"] as const) {
    const client = real[provider];
    if (client === undefined) continue;
    out[provider] = {
      ...client,
      authorizeUrl: client.authorizeUrl.bind(client),
      redeemCode: client.redeemCode.bind(client),
      refresh: client.refresh.bind(client),
      revoke: async (token) => {
        revokeCalls += 1;
        const rows = await db.selectFrom("mailboxes").select("id").where("org_id", "=", org.orgId).execute();
        revokeSaw.push({ mailboxRows: rows.length });
        return client.revoke(token);
      },
    };
  }
  return out;
}

const extrasOf = (over: Partial<WebExtras> = {}): WebExtras => ({
  secrets,
  actionsScope: { kind: "off" },
  sendScope: { kind: "off" },
  botUsername: null,
  mailOAuthClients: clients,
  mailOAuthLogin: { oauthTokens: { drop: (mailboxId) => void dropped.push(mailboxId) } },
  ...over,
});

/** The full web wiring (`apiRouters`): the route reads its secrets, clients and token cache from `WebExtras`. */
function appOf(over: Partial<WebExtras> = {}) {
  return webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId },
    routers: apiRouters(
      testConfig(),
      db,
      extrasOf(over),
      () => NOW,
      async () => [],
      noBackupCodes,
      noPrivacy
    ),
  });
}

beforeAll(async () => {
  fake = await startFakeMailOAuth();
  clients = watched(createMailOAuthClients(testConfig(), { specs: fake.specs(HOSTS) }));
});

afterAll(async () => {
  await fake.stop();
  await db.destroy();
});

beforeEach(async () => {
  org = await webOrg(db);
  dropped.length = 0;
  revokeSaw.length = 0;
  revokeCalls = 0;
  fake.calls.length = 0;
  fake.revoked.length = 0;
  logLines = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    logSpies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
});

afterEach(async () => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  await org.cleanup();
});

const addressOf = (label = "u"): string => `${label}-${randomUUID()}@x.test`;
const linesOf = (event: string) => logLines.filter((line) => line.includes(event));

interface Box {
  id: string;
  address: string;
  refreshToken: string;
}

interface SeedOpts {
  provider?: MailOAuthProvider;
  orgId?: string;
  password?: boolean;
  tenantId?: string | null;
  status?: string;
  reason?: string | null;
}

/** A mailbox with an `oauth` secret that the fake token server knows (a real redeem), or a password secret. */
async function seedMailbox(opts: SeedOpts = {}): Promise<Box> {
  const provider = opts.provider ?? "google";
  const orgId = opts.orgId ?? org.orgId;
  const id = randomUUID();
  const address = addressOf("seed");
  let refreshToken = "a-password";
  if (opts.password !== true) {
    const client = clients[provider];
    if (client === undefined) throw new Error("no client");
    refreshToken = (await client.redeemCode(fake.code({ provider, address }), VERIFIER)).refreshToken ?? "";
    fake.calls.length = 0;
  }
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: HOSTS.imap.host,
      imapPort: HOSTS.imap.port,
      smtpHost: HOSTS.smtp.host,
      smtpPort: HOSTS.smtp.port,
      capabilities: testCapabilities,
      folderMap: {},
      ...(opts.password === true
        ? {}
        : { oauthProvider: provider, sendVia: provider === "microsoft" ? ("graph" as const) : ("smtp" as const) }),
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  const clear =
    opts.password === true
      ? refreshToken
      : encodeOAuthSecret({
          v: 1,
          provider,
          refreshToken,
          tenantId: opts.tenantId === undefined ? (provider === "microsoft" ? WORK_TENANT : null) : opts.tenantId,
          scopes: ["old-scope"],
        });
  const sealed = secrets.encrypt(clear, `mailbox:${id}`);
  await insertCredentials(
    db,
    { orgId },
    {
      mailboxId: id,
      encryptedSecret: sealed.ciphertext,
      secretKind: opts.password === true ? "password" : "oauth",
      keyVersion: sealed.keyVersion,
    }
  );
  if ((opts.status ?? "active") !== "active") {
    await db
      .updateTable("mailboxes")
      .set({
        status: opts.status ?? "active",
        status_changed_at: new Date("2026-01-01T00:00:00Z"),
        auth_reason: opts.reason ?? null,
      })
      .where("id", "=", id)
      .execute();
  }
  return { id, address, refreshToken };
}

const linkOwner = () =>
  db.transaction().execute((trx) => linkChat(trx, { orgId: org.orgId }, org.ownerId, randomChatId(), NOW));
const mailboxRows = (id: string) => db.selectFrom("mailboxes").select("id").where("id", "=", id).execute();
const credentialRows = (id: string) =>
  db.selectFrom("mailbox_credentials").select("mailbox_id").where("mailbox_id", "=", id).execute();
const noticesOf = () =>
  db
    .selectFrom("outbox")
    .select(["user_id", "view", "kind", "channel", "detail", "locale", "text", "buttons"])
    .where("org_id", "=", org.orgId)
    .where("kind", "=", "mailbox_removed")
    .execute();
const removeOver = (app: ReturnType<typeof appOf>, who: string, id: string, address: string) =>
  app.request(`/api/mailboxes/${id}`, as(who, { method: "DELETE", body: { confirmAddress: address } }));

describe("Remove of a Google mailbox", () => {
  test("1. the revoke runs after the commit: the fake holds the refresh token, the answer and the notice say so", async () => {
    await linkOwner();
    const box = await seedMailbox();
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect(removeMailboxResultSchema.parse(await res.json())).toEqual({
      authMethod: "oauth",
      oauthProvider: "google",
      revoked: true,
      accessPage: "google",
    });
    expect(fake.revoked).toEqual([box.refreshToken]);
    // The mailbox and its secret are gone, and they were gone when the call went out.
    expect(await mailboxRows(box.id)).toHaveLength(0);
    expect(await credentialRows(box.id)).toHaveLength(0);
    expect(revokeSaw).toEqual([{ mailboxRows: 0 }]);
    expect(dropped).toEqual([box.id]);
    const notices = await noticesOf();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.view).toEqual({ access: { page: "google", revoked: true } });
    expect(renderedOf(notices[0] ?? failure()).text).toBe(textTables.pl.notices.mailboxRemovedAccess.googleRevoked);
    expect(linesOf("mail_oauth_revoke_failed")).toHaveLength(0);
  });

  test("2. the revoke answers 500: Remove succeeds, revoked is false, one warn line, the notice says to withdraw it", async () => {
    await linkOwner();
    const box = await seedMailbox();
    fake.failNext({ status: 500, error: "server_error" });
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      authMethod: "oauth",
      oauthProvider: "google",
      revoked: false,
      accessPage: "google",
    });
    expect(fake.revoked).toEqual([]);
    expect(await mailboxRows(box.id)).toHaveLength(0);
    const lines = linesOf("mail_oauth_revoke_failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("provider=google");
    expect(lines[0]).toContain("kind=server");
    expect(lines[0]).toContain(`mailbox_id=${box.id}`);
    const notices = await noticesOf();
    expect(notices[0]?.view).toEqual({ access: { page: "google", revoked: false } });
    expect(renderedOf(notices[0] ?? failure()).text).toBe(textTables.pl.notices.mailboxRemovedAccess.googleFailed);
    // The token cache is dropped also when the revoke failed.
    expect(dropped).toEqual([box.id]);
  });

  test("3. the revoke times out: the same result with kind timeout (the client holds the 10 s cap; here a short one)", async () => {
    await linkOwner();
    const box = await seedMailbox();
    const short = createMailOAuthClients(testConfig(), { specs: fake.specs(HOSTS), timeoutMs: 150 });
    fake.failNext("timeout");
    const res = await removeOver(appOf({ mailOAuthClients: short }), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ revoked: false, accessPage: "google" });
    const lines = linesOf("mail_oauth_revoke_failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kind=timeout");
    expect(await mailboxRows(box.id)).toHaveLength(0);
  });

  test("4. no Google client (not configured): Remove succeeds, revoked false, kind not_configured", async () => {
    await linkOwner();
    const box = await seedMailbox();
    const res = await removeOver(appOf({ mailOAuthClients: {} }), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ revoked: false, accessPage: "google" });
    expect(linesOf("mail_oauth_revoke_failed")).toHaveLength(1);
    expect(linesOf("mail_oauth_revoke_failed")[0]).toContain("kind=not_configured");
    expect(fake.revoked).toEqual([]);
    expect(await mailboxRows(box.id)).toHaveLength(0);
  });

  test("5. an unreadable secret: Remove succeeds, no call is made, kind secret_unreadable", async () => {
    await linkOwner();
    const box = await seedMailbox();
    await db
      .updateTable("mailbox_credentials")
      .set({ encrypted_secret: "not-a-ciphertext" })
      .where("mailbox_id", "=", box.id)
      .execute();
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ revoked: false, accessPage: "google" });
    expect(revokeCalls).toBe(0);
    expect(linesOf("mail_oauth_revoke_failed")[0]).toContain("kind=secret_unreadable");
    expect(await mailboxRows(box.id)).toHaveLength(0);
  });

  test("6. an already revoked token (the owner withdrew it before) counts as revoked", async () => {
    const box = await seedMailbox();
    const client = clients.google ?? failure();
    await client.revoke(box.refreshToken);
    fake.revoked.length = 0;
    revokeCalls = 0;
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect((await res.json()) as unknown).toMatchObject({ revoked: true });
    expect(revokeCalls).toBe(1);
    expect(linesOf("mail_oauth_revoke_failed")).toHaveLength(0);
  });

  test("7. a mailbox in auth_error with a reason is removed: the delete is not stopped by the reason CHECK", async () => {
    await linkOwner();
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect(await mailboxRows(box.id)).toHaveLength(0);
    expect(fake.revoked).toEqual([box.refreshToken]);
  });

  test("8. the secret is read under the mailbox lock: a refresh that holds it finishes first, and the revoke uses the new token", async () => {
    const box = await seedMailbox();
    const client = clients.google ?? failure();
    const second =
      (await client.redeemCode(fake.code({ provider: "google", address: box.address }), VERIFIER)).refreshToken ?? "";
    expect(second).not.toBe(box.refreshToken);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A "refresh" that stores a new token while it holds the lock.
    const refresher = withMailboxOAuthLock(db, box.id, async (tx) => {
      locked();
      await held;
      await saveOAuthSecret(tx, secrets, { orgId: org.orgId }, box.id, {
        v: 1,
        provider: "google",
        refreshToken: second,
        tenantId: null,
        scopes: [],
      });
    });
    await lockTaken;
    const removing = removeOver(appOf(), "owner", box.id, box.address);
    await waitForLockWaiter(box.id);
    release();
    await refresher;
    const res = await removing;
    expect(res.status).toBe(200);
    expect(fake.revoked).toEqual([second]);
  });
});

describe("Remove of a Microsoft mailbox", () => {
  test("9. a work or school tenant: no revoke call, revoked null, the page is My Apps", async () => {
    await linkOwner();
    const box = await seedMailbox({ provider: "microsoft" });
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect(removeMailboxResultSchema.parse(await res.json())).toEqual({
      authMethod: "oauth",
      oauthProvider: "microsoft",
      revoked: null,
      accessPage: "microsoft_work",
    });
    expect(revokeCalls).toBe(0);
    expect(fake.revoked).toEqual([]);
    expect(await mailboxRows(box.id)).toHaveLength(0);
    expect(dropped).toEqual([box.id]);
    const notices = await noticesOf();
    expect(notices[0]?.view).toEqual({ access: { page: "microsoft_work", revoked: null } });
    expect(renderedOf(notices[0] ?? failure()).text).toBe(textTables.pl.notices.mailboxRemovedAccess.microsoftWork);
    expect(linesOf("mail_oauth_revoke_failed")).toHaveLength(0);
  });

  test("10. the personal-account tenant: the page is the consent page of the account", async () => {
    await linkOwner();
    const box = await seedMailbox({ provider: "microsoft", tenantId: MICROSOFT_PERSONAL_TENANT });
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect((await res.json()) as unknown).toEqual({
      authMethod: "oauth",
      oauthProvider: "microsoft",
      revoked: null,
      accessPage: "microsoft_personal",
    });
    expect(revokeCalls).toBe(0);
    const notices = await noticesOf();
    expect(notices[0]?.view).toEqual({ access: { page: "microsoft_personal", revoked: null } });
    expect(renderedOf(notices[0] ?? failure()).text).toBe(textTables.pl.notices.mailboxRemovedAccess.microsoftPersonal);
  });

  test("11. an unreadable Microsoft secret: Remove succeeds and the work page is named", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    await db
      .updateTable("mailbox_credentials")
      .set({ encrypted_secret: "not-a-ciphertext" })
      .where("mailbox_id", "=", box.id)
      .execute();
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect((await res.json()) as unknown).toMatchObject({ revoked: null, accessPage: "microsoft_work" });
    expect(await mailboxRows(box.id)).toHaveLength(0);
  });
});

describe("Remove of a password mailbox and the other rules", () => {
  test("12. a password mailbox: the fields are null, the notice view is empty and the text is today's", async () => {
    await linkOwner();
    const box = await seedMailbox({ password: true });
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authMethod: "password", oauthProvider: null, revoked: null, accessPage: null });
    expect(revokeCalls).toBe(0);
    expect(dropped).toEqual([]);
    const notices = await noticesOf();
    expect(notices[0]?.view).toEqual({});
    expect(renderedOf(notices[0] ?? failure()).text).toBe(textTables.pl.notices.mailboxRemoved);
  });

  test("13. a wrong address, an assistant and another organization change nothing and call no provider", async () => {
    const box = await seedMailbox();
    const app = appOf();
    const wrong = await removeOver(app, "owner", box.id, "wrong@x.test");
    expect(wrong.status).toBe(400);
    const assistant = await removeOver(app, "assistant", box.id, box.address);
    expect(assistant.status).toBe(403);
    // The owner of the second organization asks for a mailbox of the first: not found.
    const cross = await removeOver(app, "other", box.id, box.address);
    expect(cross.status).toBe(404);
    expect(await mailboxRows(box.id)).toHaveLength(1);
    expect(await credentialRows(box.id)).toHaveLength(1);
    expect(revokeCalls).toBe(0);
    expect(fake.revoked).toEqual([]);
    expect(dropped).toEqual([]);
    const row = await db.selectFrom("mailboxes").select("status").where("id", "=", box.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("active");
  });

  test("14. the other organization removes its own mailbox: only its token is revoked, the first mailbox stays", async () => {
    const own = await seedMailbox();
    const foreign = await seedMailbox({ orgId: org.otherOrgId });
    const res = await removeOver(appOf(), "other", foreign.id, foreign.address);
    expect(res.status).toBe(200);
    expect(fake.revoked).toEqual([foreign.refreshToken]);
    expect(await mailboxRows(own.id)).toHaveLength(1);
    expect(await credentialRows(own.id)).toHaveLength(1);
    expect(await mailboxRows(foreign.id)).toHaveLength(0);
    // The notice of the second organization never reaches the first.
    expect(await noticesOf()).toHaveLength(0);
  });

  test("15. a failed delete (Microsoft): the mailbox is back to active, no cache drop, and the error is thrown", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const deps: RemoveDeps = {
      db,
      onRemoved: async () => {
        throw new Error("notice queue down");
      },
      oauth: { secrets, clients, tokens: { drop: (id) => void dropped.push(id) } },
    };
    await expect(
      removeMailbox({ ...deps }, { orgId: org.orgId }, box.id, {
        userId: org.ownerId,
        confirmAddress: box.address,
        now: NOW,
      })
    ).rejects.toThrow("notice queue down");
    const row = await db.selectFrom("mailboxes").select("status").where("id", "=", box.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("active");
    expect(await credentialRows(box.id)).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  test("16. a Google mailbox of another organization is not found: no revoke call is made", async () => {
    const box = await seedMailbox();
    const deps: RemoveDeps = {
      db,
      onRemoved: async () => undefined,
      oauth: { secrets, clients, tokens: { drop: (id) => void dropped.push(id) } },
    };
    // The delete function refuses an unknown organization of the mailbox: the row is not found, nothing is revoked.
    const result = await removeMailbox(deps, { orgId: org.otherOrgId }, box.id, {
      userId: org.otherOwnerId,
      confirmAddress: box.address,
      now: NOW,
    });
    expect(result).toEqual({ kind: "not_found" });
    expect(revokeCalls).toBe(0);
    expect(fake.revoked).toEqual([]);
  });

  test("16b. a failed delete (Google) after the secret read: no revoke call, the mailbox is back to active", async () => {
    const box = await seedMailbox();
    // The first transaction of Remove is the secret read under the lock; the second is the delete: it fails.
    let transactions = 0;
    const failing = new Proxy(db, {
      get(target, property) {
        if (property !== "transaction") {
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        }
        return () => {
          transactions += 1;
          if (transactions < 2) return target.transaction();
          return { execute: async () => Promise.reject(new Error("delete down")) };
        };
      },
    });
    const deps: RemoveDeps = {
      db: failing,
      onRemoved: async () => undefined,
      oauth: { secrets, clients, tokens: { drop: (id) => void dropped.push(id) } },
    };
    await expect(
      removeMailbox(deps, { orgId: org.orgId }, box.id, { userId: org.ownerId, confirmAddress: box.address, now: NOW })
    ).rejects.toThrow("delete down");
    expect(transactions).toBe(2);
    expect(revokeCalls).toBe(0);
    expect(fake.revoked).toEqual([]);
    expect(dropped).toEqual([]);
    const row = await db.selectFrom("mailboxes").select("status").where("id", "=", box.id).executeTakeFirstOrThrow();
    expect(row.status).toBe("active");
    expect(await credentialRows(box.id)).toHaveLength(1);
  });

  test("16c. the revoke in the web wiring uses the default client timeout of the shared constant (10 s)", async () => {
    expect(OAUTH_TIMEOUT_MS).toBe(10_000);
    const box = await seedMailbox();
    const original = AbortSignal.timeout.bind(AbortSignal);
    const timeouts: number[] = [];
    const spy = spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return original(ms);
    });
    try {
      const res = await removeOver(appOf(), "owner", box.id, box.address);
      expect((await res.json()) as unknown).toMatchObject({ revoked: true });
    } finally {
      spy.mockRestore();
    }
    // `clients` is built without `timeoutMs`; Remove passes none either: every call of the revoke carries the constant.
    expect(timeouts).toEqual([OAUTH_TIMEOUT_MS]);
  });

  test("17. a Google mailbox: the notice fails after the commit: Remove still succeeds and one error line is logged", async () => {
    const box = await seedMailbox();
    const deps: RemoveDeps = {
      db,
      onRemoved: async () => {
        throw new Error("notice queue down");
      },
      oauth: { secrets, clients },
    };
    const result = await removeMailbox(deps, { orgId: org.orgId }, box.id, {
      userId: org.ownerId,
      confirmAddress: box.address,
      now: NOW,
    });
    expect(result).toMatchObject({ kind: "removed", outcome: { revoked: true } });
    expect(await mailboxRows(box.id)).toHaveLength(0);
    expect(linesOf("mailbox_removed_notice_failed")).toHaveLength(1);
  });

  test("18. the audit row and the notice rows hold no token, the address or the provider's text", async () => {
    await linkOwner();
    const box = await seedMailbox();
    fake.failNext({ status: 500, error: "server_error", description: `boom ${box.refreshToken}` });
    const res = await removeOver(appOf(), "owner", box.id, box.address);
    const body = await res.text();
    const audit = await db.selectFrom("audit_log").selectAll().where("org_id", "=", org.orgId).execute();
    const stored = inspect([body, audit, await noticesOf()], { depth: 8 });
    for (const secret of [box.refreshToken, ...fake.issuedRefreshTokens, fake.clientSecret]) {
      expect(stored).not.toContain(secret);
      expect(logLines.join("\n")).not.toContain(secret);
    }
    expect(logLines.join("\n")).not.toContain("boom");
    expect(audit.some((row) => row.event === "mailbox.removed")).toBe(true);
  });
});

function failure(): never {
  throw new Error("unexpected state");
}

/** Resolves when Postgres shows an advisory lock request of this mailbox that is not granted: a waiter is at the lock. */
async function waitForLockWaiter(mailboxId: string): Promise<void> {
  const waiting = async (): Promise<number> => {
    const { rows } = await sql<{ n: string }>`
      select count(*) as n from pg_locks
      where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())
        and ((classid::bigint << 32) | objid::bigint) = hashtextextended(${`mailbox_oauth:${mailboxId}`}, 0)`.execute(
      db
    );
    return Number(rows[0]?.n);
  };
  const deadline = Date.now() + 10_000;
  while ((await waiting()) === 0) {
    if (Date.now() > deadline) throw new Error("nobody waits at the lock");
    await Bun.sleep(25);
  }
}
