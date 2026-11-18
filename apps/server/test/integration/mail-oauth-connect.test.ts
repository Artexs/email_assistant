import { randomBytes, randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { sql } from "kysely";

import {
  applyOAuthGrant,
  createMailOAuthClients,
  createOAuthState,
  createOAuthTokens,
  MailAuthError,
  openImapProvider,
  verifySmtpLogin,
  type ApplyGrantDeps,
  type MailOAuthClients,
  type MailOAuthProvider,
  type OAuthGrant,
  type OAuthStart,
} from "../../src/modules/mail";
import {
  decodeOAuthSecret,
  encodeOAuthSecret,
  readOAuthSecret,
  saveOAuthSecret,
  withMailboxOAuthLock,
} from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { currentTenantScope } from "../../src/platform/db";
import { apiPublicRouters, type WebExtras } from "../../src/web";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { insertTestEmail, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// Connect and Reconnect of an OAuth mailbox and the callback route. The token endpoint is the fake token server; the mail
// login runs against GreenMail (auth off: it takes any token), or a stub that refuses. Rows are committed, because the state store and
// the Reconnect lock run their own transactions. No real provider call.
const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const MAIL_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const IMAP_PORT = Number(process.env.TEST_IMAP_PORT ?? "3143");
const SMTP_PORT = Number(process.env.TEST_SMTP_PORT ?? "3025");
const HOSTS = {
  imap: { host: MAIL_HOST, port: IMAP_PORT },
  smtp: { host: MAIL_HOST, port: SMTP_PORT, security: "tls" as const },
};
const GOOGLE_MAIL = "https://mail.google.com/";

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let secondOwnerId = "";
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

// What the login stub saw, and what it refuses.
const login = {
  imap: [] as { user: string; host: string; port: number; accessToken: string; scope: string | null }[],
  smtp: [] as { user: string; accessToken: string }[],
  refuseImap: false,
  refuseSmtp: false,
  /** The one user the access token belongs to; any other login user is refused. Null: no check. */
  accountUser: null as string | null,
  throwImap: null as Error | null,
};
const dropped: string[] = [];

const extrasOf = (over: Partial<WebExtras> = {}): WebExtras => ({
  secrets,
  actionsScope: { kind: "off" },
  sendScope: { kind: "off" },
  botUsername: null,
  mailOAuthClients: clients,
  mailOAuthLogin: {
    openProvider: async (opts) => {
      login.imap.push({
        user: opts.user,
        host: opts.host,
        port: opts.port,
        accessToken: opts.auth.kind === "oauth" ? opts.auth.accessToken : "",
        scope: currentTenantScope(),
      });
      if (login.throwImap !== null) throw login.throwImap;
      if (login.refuseImap || (login.accountUser !== null && opts.user !== login.accountUser)) {
        throw new MailAuthError("IMAP login failed");
      }
      return openImapProvider(opts);
    },
    verifySmtp: async (opts) => {
      login.smtp.push({ user: opts.user, accessToken: opts.auth.kind === "oauth" ? opts.auth.accessToken : "" });
      if (login.refuseSmtp) throw new MailAuthError("SMTP login failed");
      return verifySmtpLogin(opts);
    },
    oauthTokens: { drop: (mailboxId) => void dropped.push(mailboxId) },
  },
  ...over,
});

const testConfig = () =>
  loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: TEST_ORIGIN,
    WEB_AUTH_SECRET: "x".repeat(32),
  });

function makeClients(): MailOAuthClients {
  return createMailOAuthClients(
    loadConfig({
      DATABASE_URL: "postgres://x",
      CREDENTIALS_KEY: randomBytes(32).toString("base64"),
      WEB_BASE_URL: TEST_ORIGIN,
      WEB_AUTH_SECRET: "x".repeat(32),
      MAIL_OAUTH_MICROSOFT_CLIENT_ID: fake.clientId,
      MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: fake.clientSecret,
      MAIL_OAUTH_GOOGLE_CLIENT_ID: fake.clientId,
      MAIL_OAUTH_GOOGLE_CLIENT_SECRET: fake.clientSecret,
    }),
    { specs: fake.specs(HOSTS) }
  );
}

function appOf(over: { extras?: Partial<WebExtras>; suspended?: boolean; failSuspendedRead?: Error } = {}) {
  return webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId, other: org.otherOwnerId, owner2: secondOwnerId },
    routers: () => undefined,
    publicRouters: apiPublicRouters(testConfig(), db, extrasOf(over.extras), () => new Date()),
    isOrgSuspended: async () => {
      if (over.failSuspendedRead !== undefined) throw over.failSuspendedRead;
      return over.suspended === true;
    },
  });
}

beforeAll(async () => {
  fake = await startFakeMailOAuth();
  clients = makeClients();
});

afterAll(async () => {
  await fake.stop();
  await db.destroy();
});

beforeEach(async () => {
  org = await webOrg(db);
  const second = await insertUser(db, { email: `second-owner-${randomUUID()}@x.test`, displayName: "Second owner" });
  secondOwnerId = second.id;
  await insertMembership(db, { orgId: org.orgId }, { userId: secondOwnerId, role: "owner" });
  login.imap.length = 0;
  login.smtp.length = 0;
  login.refuseImap = false;
  login.refuseSmtp = false;
  login.accountUser = null;
  login.throwImap = null;
  dropped.length = 0;
  fake.calls.length = 0;
  fake.rotate.microsoft = true;
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
  await db.deleteFrom("users").where("id", "=", secondOwnerId).execute();
});

const ctxA = () => ({ orgId: org.orgId });
const addressOf = (label = "u"): string => `${label}-${randomUUID()}@x.test`;
const enable = (provider: MailOAuthProvider, flag = `mail_oauth_${provider}`) =>
  setOrgFeature(db, ctxA(), { flag, enabled: true, actor: org.ownerId, now: new Date() });

interface SignedIn {
  query: Record<string, string>;
  state: string;
  code: string;
  userId: string;
}

/** A sign-in the callback can finish: a state row of the user and a fake code bound to its challenge. */
async function signIn(
  provider: MailOAuthProvider,
  who: { address: string; userId?: string; mailboxId?: string | null; orgId?: string }
): Promise<SignedIn> {
  const userId = who.userId ?? org.ownerId;
  const start: OAuthStart = { provider, userId, mailboxId: who.mailboxId ?? null };
  const made = await createOAuthState(db, secrets, { orgId: who.orgId ?? org.orgId }, start, new Date());
  const code = fake.code({ provider, address: who.address, codeChallenge: made.codeChallenge });
  return { query: { code, state: made.state }, state: made.state, code, userId };
}

const callback = (
  app: ReturnType<typeof appOf>,
  cookie: string | null,
  provider: string,
  query: Record<string, string>
) =>
  app.request(
    `/api/mailboxes/oauth/${provider}/callback?${new URLSearchParams(query).toString()}`,
    cookie === null ? { method: "GET" } : as(cookie)
  );

const locationOf = (res: Response): string => {
  expect(res.status).toBe(303);
  return res.headers.get("location") ?? "";
};
const resultOf = (res: Response): URLSearchParams => new URL(locationOf(res), "http://x.test").searchParams;

const mailboxRows = (address: string) =>
  db.selectFrom("mailboxes").selectAll().where("org_id", "=", org.orgId).where("address", "=", address).execute();
const stateRows = () => db.selectFrom("mailbox_oauth_states").selectAll().where("org_id", "=", org.orgId).execute();
const auditOf = (event: string) =>
  db.selectFrom("audit_log").selectAll().where("org_id", "=", org.orgId).where("event", "=", event).execute();
const credentialsOf = (mailboxId: string) =>
  db.selectFrom("mailbox_credentials").selectAll().where("mailbox_id", "=", mailboxId).executeTakeFirst();
const secretOf = async (mailboxId: string) => {
  const row = await credentialsOf(mailboxId);
  if (row === undefined) throw new Error("no credentials");
  return decodeOAuthSecret(
    secrets.decrypt({ ciphertext: row.encrypted_secret, keyVersion: row.key_version }, `mailbox:${mailboxId}`)
  );
};

interface SeedOpts {
  provider?: MailOAuthProvider;
  address?: string;
  status?: string;
  reason?: string | null;
  orgId?: string;
  password?: boolean;
  refreshToken?: string;
}

/** A mailbox at the local mail server, with an `oauth` secret (or a password secret). */
async function seedMailbox(opts: SeedOpts = {}): Promise<{ id: string; address: string; refreshToken: string }> {
  const provider = opts.provider ?? "google";
  const orgId = opts.orgId ?? org.orgId;
  const id = randomUUID();
  const address = opts.address ?? addressOf("seed");
  const refreshToken = opts.refreshToken ?? `old-refresh-${randomUUID()}`;
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
      ? "a-password"
      : encodeOAuthSecret({ v: 1, provider, refreshToken, tenantId: null, scopes: ["old-scope"] });
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
  const status = opts.status ?? "active";
  if (status !== "active") {
    await db
      .updateTable("mailboxes")
      .set({ status, status_changed_at: new Date("2026-01-01T00:00:00Z"), auth_reason: opts.reason ?? null })
      .where("id", "=", id)
      .execute();
  }
  return { id, address, refreshToken };
}

const mailboxOf = (id: string) => db.selectFrom("mailboxes").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("Connect", () => {
  test("1. Google: 303 to connected with the mailbox id; the row, the secret, the audit row and the Sent switch (off)", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    const res = await callback(appOf(), "owner", "google", query);
    const result = resultOf(res);
    expect(result.get("oauth")).toBe("connected");
    // The URL carries a single-use code: no cache may keep the redirect.
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [row] = await mailboxRows(address);
    expect(row).toBeDefined();
    expect(result.get("mailbox")).toBe(row?.id ?? "");
    expect(locationOf(res)).toStartWith("/mailboxes?oauth=connected&mailbox=");
    expect(row).toMatchObject({
      send_via: "smtp",
      oauth_provider: "google",
      imap_host: HOSTS.imap.host,
      imap_port: HOSTS.imap.port,
      smtp_host: HOSTS.smtp.host,
      smtp_port: HOSTS.smtp.port,
      smtp_security: "tls",
      status: "active",
      auth_reason: null,
    });
    const id = row?.id ?? "";
    expect((await credentialsOf(id))?.secret_kind).toBe("oauth");
    const stored = await secretOf(id);
    expect(stored).toEqual({
      v: 1,
      provider: "google",
      refreshToken: fake.issuedRefreshTokens.at(-1) ?? "",
      tenantId: null,
      scopes: expect.arrayContaining([GOOGLE_MAIL]),
    });
    // The login tests: IMAP and SMTP, both with the grant address; Google needs no refresh.
    expect(login.imap.map((entry) => entry.user)).toEqual([address]);
    expect(login.smtp.map((entry) => entry.user)).toEqual([address]);
    expect(fake.calls.filter((call) => call.grant === "refresh_token")).toHaveLength(0);
    // The same rows as a password connect: inbox folder, default settings, a Sent state row that is off (the flag is off).
    const sent = await db.selectFrom("mailbox_sent_sync").selectAll().where("mailbox_id", "=", id).execute();
    expect(sent.map((entry) => entry.enabled)).toEqual([false]);
    const settings = await db
      .selectFrom("mailbox_settings")
      .select("mailbox_id")
      .where("mailbox_id", "=", id)
      .execute();
    expect(settings).toHaveLength(1);
    const folders = await db.selectFrom("mailbox_folders").select("key").where("mailbox_id", "=", id).execute();
    expect(folders.map((folder) => folder.key)).toEqual(["inbox"]);
    const audit = await auditOf("mailbox.connected");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe(org.ownerId);
    expect(audit[0]?.data).toEqual({
      mailbox_id: id,
      via: "web",
      method: "oauth",
      provider: "google",
      sent_sync: false,
    });
    expect(await stateRows()).toHaveLength(0);
  });

  test("1b. the Sent switch follows the sent_sync flag, as connectMailbox does", async () => {
    await enable("google");
    await enable("google", "sent_sync");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    const result = resultOf(await callback(appOf(), "owner", "google", query));
    expect(result.get("oauth")).toBe("connected");
    const sent = await db
      .selectFrom("mailbox_sent_sync")
      .select("enabled")
      .where("mailbox_id", "=", result.get("mailbox") ?? "")
      .execute();
    expect(sent.map((entry) => entry.enabled)).toEqual([true]);
    const audit = await auditOf("mailbox.connected");
    expect(audit[0]?.data).toMatchObject({ sent_sync: true });
  });

  test("2. Microsoft: send_via graph, one graph refresh, the rotated refresh token is the one stored", async () => {
    await enable("microsoft");
    const address = addressOf();
    const { query } = await signIn("microsoft", { address });
    const result = resultOf(await callback(appOf(), "owner", "microsoft", query));
    expect(result.get("oauth")).toBe("connected");
    const [row] = await mailboxRows(address);
    expect(row).toMatchObject({ send_via: "graph", oauth_provider: "microsoft", smtp_host: HOSTS.smtp.host });
    const refreshes = fake.calls.filter((call) => call.grant === "refresh_token");
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.scope).toContain("graph.microsoft.com/Mail.Send");
    // The redeem issued token 1; the graph refresh rotated it to token 2. Token 2 is stored.
    const issued = fake.issuedRefreshTokens;
    const stored = await secretOf(row?.id ?? "");
    expect(stored.refreshToken).toBe(issued.at(-1) ?? "");
    expect(stored.refreshToken).not.toBe(issued.at(-2) ?? "");
    expect(stored.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    // Microsoft mail goes out through Graph: no SMTP login test.
    expect(login.smtp).toHaveLength(0);
    expect(login.imap.map((entry) => entry.user)).toEqual([address]);
  });

  test("2b. Microsoft without rotation: the token of the code redeem is stored", async () => {
    await enable("microsoft");
    fake.rotate.microsoft = false;
    const issuedBefore = fake.issuedRefreshTokens.length;
    const address = addressOf();
    const { query } = await signIn("microsoft", { address });
    expect(resultOf(await callback(appOf(), "owner", "microsoft", query)).get("oauth")).toBe("connected");
    const [row] = await mailboxRows(address);
    expect((await secretOf(row?.id ?? "")).refreshToken).toBe(fake.issuedRefreshTokens.at(-1) ?? "");
    expect(fake.issuedRefreshTokens).toHaveLength(issuedBefore + 1);
  });

  test("3. the graph refresh says admin consent (AADSTS 65001): admin_consent_required with the provider, nothing stored", async () => {
    await enable("microsoft");
    const address = addressOf();
    const { query } = await signIn("microsoft", { address });
    fake.failNextRefresh({ status: 400, error: "invalid_grant", aadsts: 65001 });
    const res = await callback(appOf(), "owner", "microsoft", query);
    expect(locationOf(res)).toBe("/mailboxes?oauth=admin_consent_required&provider=microsoft");
    expect(await mailboxRows(address)).toHaveLength(0);
    expect(await auditOf("mailbox.connected")).toHaveLength(0);
    expect(await stateRows()).toHaveLength(0);
  });

  test("3b. a soft error of the graph refresh (5xx): oauth_failed, nothing stored", async () => {
    await enable("microsoft");
    const address = addressOf();
    const { query } = await signIn("microsoft", { address });
    fake.failNextRefresh({ status: 503, error: "temporarily_unavailable" });
    expect(resultOf(await callback(appOf(), "owner", "microsoft", query)).get("oauth")).toBe("oauth_failed");
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("4. a second connect of the same address (any case): mailbox_exists, one row, no login", async () => {
    await enable("google");
    const address = addressOf("dup");
    const first = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", first.query)).get("oauth")).toBe("connected");
    login.imap.length = 0;
    const second = await signIn("google", { address: address.toUpperCase().replace("@X.TEST", "@x.test") });
    const res = await callback(appOf(), "owner", "google", second.query);
    expect(locationOf(res)).toBe("/mailboxes?oauth=mailbox_exists");
    expect(await mailboxRows(address)).toHaveLength(1);
    expect(login.imap).toHaveLength(0);
    expect(await auditOf("mailbox.connected")).toHaveLength(1);
  });

  test("4b. the same address in another organization does not count: it connects, and the other mailbox stays", async () => {
    await enable("google");
    const address = addressOf("shared");
    const other = await seedMailbox({ orgId: org.otherOrgId, address, refreshToken: "other-org-token" });
    const { query } = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    expect(await mailboxRows(address)).toHaveLength(1);
    expect((await secretOf(other.id)).refreshToken).toBe("other-org-token");
    const rows = await db.selectFrom("mailboxes").select("org_id").where("address", "=", address).execute();
    expect(rows.map((row) => row.org_id).sort()).toEqual([org.orgId, org.otherOrgId].sort());
  });

  test("5. at the mailbox limit: mailbox_limit, no login, nothing stored", async () => {
    await enable("google");
    await seedMailbox();
    await db.updateTable("organizations").set({ max_mailboxes: 1 }).where("id", "=", org.orgId).execute();
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(locationOf(await callback(appOf(), "owner", "google", query))).toBe("/mailboxes?oauth=mailbox_limit");
    expect(login.imap).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("5b. a limit of another organization does not count", async () => {
    await enable("google");
    await seedMailbox({ orgId: org.otherOrgId });
    await db.updateTable("organizations").set({ max_mailboxes: 1 }).where("id", "=", org.otherOrgId).execute();
    const { query } = await signIn("google", { address: addressOf() });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
  });

  test("6. the flag is off at the callback: feature_off, no login, nothing stored", async () => {
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(locationOf(await callback(appOf(), "owner", "google", query))).toBe("/mailboxes?oauth=feature_off");
    expect(login.imap).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("7. IMAP refuses the login: protocol_disabled, nothing stored", async () => {
    await enable("google");
    login.refuseImap = true;
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(locationOf(await callback(appOf(), "owner", "google", query))).toBe("/mailboxes?oauth=protocol_disabled");
    expect(await mailboxRows(address)).toHaveLength(0);
    expect(await auditOf("mailbox.connected")).toHaveLength(0);
  });

  test("7b. Google: SMTP refuses the XOAUTH2 login: protocol_disabled, nothing stored", async () => {
    await enable("google");
    login.refuseSmtp = true;
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("protocol_disabled");
    expect(login.imap).toHaveLength(1);
    expect(login.smtp).toHaveLength(1);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("7c. the address of the ID token is not the account of the access token: the login with user = grant.address is refused", async () => {
    await enable("microsoft");
    // The ID token says victim@x.test (an unverified `email` claim); the access token belongs to attacker@x.test.
    login.accountUser = addressOf("attacker");
    const victim = addressOf("victim");
    const { query } = await signIn("microsoft", { address: victim });
    expect(resultOf(await callback(appOf(), "owner", "microsoft", query)).get("oauth")).toBe("protocol_disabled");
    expect(login.imap.map((entry) => entry.user)).toEqual([victim]);
    expect(await mailboxRows(victim)).toHaveLength(0);
    expect(fake.calls.filter((call) => call.grant === "refresh_token")).toHaveLength(0);
  });

  test("7d. a fault that is no refusal (a network error): oauth_failed, not protocol_disabled; nothing stored", async () => {
    await enable("google");
    login.throwImap = new Error("socket hang up");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("oauth_failed");
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("8. two states of one address at once: one connects, the other gets mailbox_exists; one row", async () => {
    await enable("google");
    const address = addressOf("race");
    const one = await signIn("google", { address });
    const two = await signIn("google", { address });
    const app = appOf();
    const results = await Promise.all([
      callback(app, "owner", "google", one.query),
      callback(app, "owner", "google", two.query),
    ]);
    const codes = results.map((res) => resultOf(res).get("oauth")).sort();
    expect(codes).toEqual(["connected", "mailbox_exists"]);
    expect(await mailboxRows(address)).toHaveLength(1);
    expect(await auditOf("mailbox.connected")).toHaveLength(1);
  });

  test("8b. a mailbox that the unique index refuses after the checks (a parallel connect): mailbox_exists, no 500", async () => {
    await enable("google");
    const address = addressOf("index");
    const { query } = await signIn("google", { address });
    // The existing mailbox appears while the login test runs: after the first duplicate check, before the insert.
    const app = appOf({
      extras: {
        mailOAuthLogin: {
          ...extrasOf().mailOAuthLogin,
          verifySmtp: async () => {
            await seedMailbox({ address });
          },
        },
      },
    });
    expect(locationOf(await callback(app, "owner", "google", query))).toBe("/mailboxes?oauth=mailbox_exists");
    expect(await mailboxRows(address)).toHaveLength(1);
    expect(await auditOf("mailbox.connected")).toHaveLength(0);
  });

  test("8c. two connects of two addresses at once with a limit of 1: one connects, one gets mailbox_limit", async () => {
    await enable("google");
    await db.updateTable("organizations").set({ max_mailboxes: 1 }).where("id", "=", org.orgId).execute();
    const one = await signIn("google", { address: addressOf("limit-a") });
    const two = await signIn("google", { address: addressOf("limit-b") });
    const app = appOf();
    const results = await Promise.all([
      callback(app, "owner", "google", one.query),
      callback(app, "owner", "google", two.query),
    ]);
    expect(results.map((res) => resultOf(res).get("oauth")).sort()).toEqual(["connected", "mailbox_limit"]);
    expect(await db.selectFrom("mailboxes").select("id").where("org_id", "=", org.orgId).execute()).toHaveLength(1);
  });
});

describe("the history check at an OAuth connect", () => {
  const checks = () =>
    db
      .selectFrom("history_checks")
      .select(["mailbox_id", "status", "reason"])
      .where("org_id", "=", org.orgId)
      .execute();
  const trustOn = () =>
    setOrgFeature(db, ctxA(), { flag: "trust_ladder", enabled: true, actor: org.ownerId, now: new Date() });

  test("5. a new mailbox with the flag on: one queued check with the reason connect", async () => {
    await enable("google");
    await trustOn();
    const address = addressOf("trust");
    const { query } = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    const [row] = await mailboxRows(address);
    expect(await checks()).toEqual([{ mailbox_id: row?.id ?? "", status: "queued", reason: "connect" }]);
  });

  test("5b. the flag off: no check", async () => {
    await enable("google");
    const { query } = await signIn("google", { address: addressOf("notrust") });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    expect(await checks()).toEqual([]);
  });

  test("5c. a Reconnect of an existing mailbox queues nothing", async () => {
    await trustOn();
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
    expect(await checks()).toEqual([]);
  });

  test("5d. two states of one address at once with the flag on: one mailbox, one check", async () => {
    await enable("google");
    await trustOn();
    const address = addressOf("trustrace");
    const one = await signIn("google", { address });
    const two = await signIn("google", { address });
    const app = appOf();
    const results = await Promise.all([
      callback(app, "owner", "google", one.query),
      callback(app, "owner", "google", two.query),
    ]);
    expect(results.map((res) => resultOf(res).get("oauth")).sort()).toEqual(["connected", "mailbox_exists"]);
    expect(await checks()).toHaveLength(1);
  });

  test("5e. a hook that throws: the Connect still succeeds, the mailbox exists, one warning without the address", async () => {
    await enable("google");
    const address = addressOf("hookfail");
    const result = await applyOAuthGrant(
      {
        ...depsOf(),
        onConnected: async () => {
          throw new Error(`detail of ${address}`);
        },
      },
      ctxA(),
      grantOf("google", address, null),
      org.ownerId
    );
    expect(result).toMatchObject({ ok: true, code: "connected" });
    expect(await mailboxRows(address)).toHaveLength(1);
    expect(logLines.filter((line) => line.includes("connect_hook_failed"))).toHaveLength(1);
    expect(logLines.join("\n")).not.toContain(address);
  });
});

/** A grant for `applyOAuthGrant` called by hand (no route). */
function grantOf(
  provider: MailOAuthProvider,
  address: string,
  mailboxId: string | null,
  over: Partial<OAuthGrant> = {}
): OAuthGrant {
  return {
    start: { provider, userId: org.ownerId, mailboxId },
    provider,
    address,
    tenantId: provider === "microsoft" ? "11111111-1111-1111-1111-111111111111" : null,
    refreshToken: `new-refresh-${randomUUID()}`,
    mailAccessToken: `at-direct-${randomUUID()}`,
    mailExpiresInSec: 3599,
    scopes: ["new-scope"],
    ...over,
  };
}

const depsOf = (): ApplyGrantDeps => {
  const extras = extrasOf();
  return {
    db,
    secrets,
    clients,
    openProvider: extras.mailOAuthLogin?.openProvider ?? openImapProvider,
    verifySmtp: extras.mailOAuthLogin?.verifySmtp ?? verifySmtpLogin,
    oauthTokens: { drop: (mailboxId) => void dropped.push(mailboxId) },
    now: () => new Date(),
  };
};

describe("Reconnect", () => {
  test("9b. the route drops the real token cache of the mailbox: the next token call refreshes with the new refresh token", async () => {
    const address = addressOf("seed");
    const redeemed = await clients.google?.redeemCode(fake.code({ provider: "google", address }), "v".repeat(43));
    const box = await seedMailbox({
      address,
      refreshToken: redeemed?.refreshToken ?? "",
      status: "auth_error",
      reason: "oauth_expired",
    });
    const tokens = createOAuthTokens({ pool: db, secrets, clients, now: () => new Date() });
    const first = await tokens.accessToken(ctxA(), box.id, "mail");
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).toBe(first);
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    const app = appOf({ extras: { mailOAuthLogin: { ...extrasOf().mailOAuthLogin, oauthTokens: tokens } } });
    expect(locationOf(await callback(app, "owner", "google", query))).toBe(
      `/mailboxes?oauth=reconnected&mailbox=${box.id}`
    );
    fake.calls.length = 0;
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).not.toBe(first);
    const refreshes = fake.calls.filter((call) => call.grant === "refresh_token");
    expect(refreshes.map((call) => call.refreshToken)).toEqual([(await secretOf(box.id)).refreshToken]);
  });

  test("9. an auth_error mailbox with the reason oauth_expired and 3 mails: reconnected, same id, active, no reason, 3 rows, new secret", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    await db.transaction().execute(async (trx) => {
      for (const uid of [1, 2, 3]) await insertTestEmail(trx, ctxA(), box.id, { uid });
    });
    const before = await mailboxOf(box.id);
    const { query, code } = await signIn("google", { address: box.address, mailboxId: box.id });
    void code;
    const res = await callback(appOf(), "owner", "google", query);
    expect(locationOf(res)).toBe(`/mailboxes?oauth=reconnected&mailbox=${box.id}`);
    const after = await mailboxOf(box.id);
    expect(after.id).toBe(box.id);
    expect(after.status).toBe("active");
    expect(after.auth_reason).toBeNull();
    expect(after.status_changed_at.getTime()).toBeGreaterThan(before.status_changed_at.getTime());
    const mails = await db.selectFrom("emails").select("id").where("mailbox_id", "=", box.id).execute();
    expect(mails).toHaveLength(3);
    const stored = await secretOf(box.id);
    expect(stored.refreshToken).toBe(fake.issuedRefreshTokens.at(-1) ?? "");
    expect(stored.refreshToken).not.toBe(box.refreshToken);
    expect(stored.scopes).toContain(GOOGLE_MAIL);
    expect((await credentialsOf(box.id))?.secret_kind).toBe("oauth");
    expect(dropped).toEqual([box.id]);
    const audit = await auditOf("mailbox.reconnected");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toEqual({ mailbox_id: box.id, via: "web", provider: "google", reactivated: true });
    expect(await auditOf("mailbox.connected")).toHaveLength(0);
    // A Reconnect adds no mailbox.
    expect(await db.selectFrom("mailboxes").select("id").where("org_id", "=", org.orgId).execute()).toHaveLength(1);
  });

  test("10. a host_blocked mailbox becomes active", async () => {
    const box = await seedMailbox({ status: "host_blocked" });
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
    expect((await mailboxOf(box.id)).status).toBe("active");
  });

  test("11. a paused mailbox stays paused, with the new secret", async () => {
    const box = await seedMailbox({ status: "paused" });
    const before = await mailboxOf(box.id);
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
    const after = await mailboxOf(box.id);
    expect(after.status).toBe("paused");
    expect(after.status_changed_at.getTime()).toBe(before.status_changed_at.getTime());
    expect((await secretOf(box.id)).refreshToken).not.toBe(box.refreshToken);
    expect((await auditOf("mailbox.reconnected"))[0]?.data).toMatchObject({ reactivated: false });
  });

  test("11b. an active mailbox reconnects too (a user may reconnect before a failure)", async () => {
    const box = await seedMailbox();
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
    expect((await mailboxOf(box.id)).status).toBe("active");
  });

  test("12. a Reconnect works with the provider flag off", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_revoked" });
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
  });

  test("13. another account signs in: oauth_wrong_account, nothing changes", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const { query } = await signIn("google", { address: addressOf("eve"), mailboxId: box.id });
    expect(locationOf(await callback(appOf(), "owner", "google", query))).toBe("/mailboxes?oauth=oauth_wrong_account");
    const after = await mailboxOf(box.id);
    expect(after).toMatchObject({ status: "auth_error", auth_reason: "oauth_expired" });
    expect((await secretOf(box.id)).refreshToken).toBe(box.refreshToken);
    expect(login.imap).toHaveLength(0);
    expect(dropped).toHaveLength(0);
  });

  test("14. the login test is refused: protocol_disabled; status, reason and secret stay", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    login.refuseImap = true;
    const { query } = await signIn("google", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("protocol_disabled");
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_expired" });
    expect((await secretOf(box.id)).refreshToken).toBe(box.refreshToken);
    expect(dropped).toHaveLength(0);
    expect(await auditOf("mailbox.reconnected")).toHaveLength(0);
  });

  test("15. Microsoft: a graph refresh with admin consent missing: nothing changes; a good one stores the rotated token", async () => {
    const box = await seedMailbox({ provider: "microsoft", status: "auth_error", reason: "oauth_expired" });
    const bad = await signIn("microsoft", { address: box.address, mailboxId: box.id });
    fake.failNextRefresh({ status: 400, error: "invalid_grant", aadsts: 65001 });
    expect(locationOf(await callback(appOf(), "owner", "microsoft", bad.query))).toBe(
      "/mailboxes?oauth=admin_consent_required&provider=microsoft"
    );
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_expired" });
    expect((await secretOf(box.id)).refreshToken).toBe(box.refreshToken);

    const good = await signIn("microsoft", { address: box.address, mailboxId: box.id });
    expect(resultOf(await callback(appOf(), "owner", "microsoft", good.query)).get("oauth")).toBe("reconnected");
    const stored = await secretOf(box.id);
    expect(stored.refreshToken).toBe(fake.issuedRefreshTokens.at(-1) ?? "");
    expect(stored.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null, send_via: "graph" });
  });

  test("16. a mailbox of another organization is never touched, also when its id is named", async () => {
    const other = await seedMailbox({ orgId: org.otherOrgId, status: "auth_error", reason: "oauth_expired" });
    const before = await credentialsOf(other.id);
    const result = await applyOAuthGrant(depsOf(), ctxA(), grantOf("google", other.address, other.id), org.ownerId);
    expect(result).toEqual({ ok: false, code: "oauth_failed" });
    expect(await mailboxOf(other.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_expired" });
    expect((await credentialsOf(other.id))?.encrypted_secret).toBe(before?.encrypted_secret ?? "");
    expect(login.imap).toHaveLength(0);
    expect(await auditOf("mailbox.reconnected")).toHaveLength(0);
    expect(dropped).toHaveLength(0);
  });

  test("17. a password mailbox or a mailbox of another provider has nothing to reconnect", async () => {
    const password = await seedMailbox({ password: true });
    const microsoft = await seedMailbox({ provider: "microsoft" });
    for (const box of [password, microsoft]) {
      const before = await credentialsOf(box.id);
      const result = await applyOAuthGrant(depsOf(), ctxA(), grantOf("google", box.address, box.id), org.ownerId);
      expect(result).toEqual({ ok: false, code: "oauth_failed" });
      expect((await credentialsOf(box.id))?.encrypted_secret).toBe(before?.encrypted_secret ?? "");
    }
    // No login ran: a grant of one provider never sends its access token to the hosts of a mailbox of another kind.
    expect(login.imap).toHaveLength(0);
    expect(login.smtp).toHaveLength(0);
    expect((await credentialsOf(password.id))?.secret_kind).toBe("password");
  });

  test("17d. a Reconnect tests the login at the hosts stored on the mailbox, not at the registry hosts (decision, F117 stage 10)", async () => {
    // Decision: keep the stored hosts. The jobs connect there with the new token, so the check must too. A refusal when the registry
    // hosts differ would strand a mailbox after a registry change, with Remove as the only way out. No path changes the hosts after
    // the insert, and the insert took them from the registry, so the token goes to the host the registry named for the provider.
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    await db
      .updateTable("mailboxes")
      .set({ imap_host: "stored-imap.x.test", imap_port: 1993, smtp_host: "stored-smtp.x.test" })
      .where("id", "=", box.id)
      .execute();
    login.refuseImap = true;
    const result = await applyOAuthGrant(depsOf(), ctxA(), grantOf("google", box.address, box.id), org.ownerId);
    expect(result).toEqual({ ok: false, code: "protocol_disabled" });
    expect(login.imap).toMatchObject([{ host: "stored-imap.x.test", port: 1993 }]);
    expect(login.imap[0]?.host).not.toBe(HOSTS.imap.host);
  });

  test("17c. an oauth_provider mailbox whose secret is a password (a broken row) is refused under the lock; the secret stays", async () => {
    const box = await seedMailbox({ password: true });
    await db.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", box.id).execute();
    const before = await credentialsOf(box.id);
    const result = await applyOAuthGrant(depsOf(), ctxA(), grantOf("google", box.address, box.id), org.ownerId);
    expect(result).toEqual({ ok: false, code: "oauth_failed" });
    const after = await credentialsOf(box.id);
    expect(after?.secret_kind).toBe("password");
    expect(after?.encrypted_secret).toBe(before?.encrypted_secret ?? "");
    expect(dropped).toHaveLength(0);
  });

  test("17b. no client for the provider: not_configured", async () => {
    const box = await seedMailbox();
    const deps = { ...depsOf(), clients: {} };
    expect(await applyOAuthGrant(deps, ctxA(), grantOf("google", box.address, box.id), org.ownerId)).toEqual({
      ok: false,
      code: "not_configured",
    });
  });

  test("18. the secret is replaced under the mailbox lock: a Reconnect waits for a holder of the lock (two connections)", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = withMailboxOAuthLock(db, box.id, async () => {
      acquired();
      await held;
    });
    await holding;
    let settled = false;
    const grant = grantOf("google", box.address, box.id);
    const reconnecting = applyOAuthGrant(depsOf(), ctxA(), grant, org.ownerId).then((result) => {
      settled = true;
      return result;
    });
    // The login tests run before the lock. Wait until Postgres shows a lock request that is not granted: the Reconnect is at the lock.
    // Only the lock key of this mailbox counts: another suite that waits on an advisory lock cannot end the wait early.
    const waiting = async (): Promise<number> => {
      const { rows } = await sql<{ n: string }>`
        select count(*) as n from pg_locks
        where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())
          and ((classid::bigint << 32) | objid::bigint) = hashtextextended(${`mailbox_oauth:${box.id}`}, 0)`.execute(
        db
      );
      return Number(rows[0]?.n);
    };
    const deadline = Date.now() + 10_000;
    while ((await waiting()) === 0) {
      if (Date.now() > deadline) throw new Error("the Reconnect never reached the lock");
      await Bun.sleep(25);
    }
    expect(settled).toBe(false);
    expect((await secretOf(box.id)).refreshToken).toBe(box.refreshToken);
    expect((await mailboxOf(box.id)).status).toBe("auth_error");
    release();
    await holder;
    expect(await reconnecting).toMatchObject({ ok: true, code: "reconnected", mailboxId: box.id });
    expect((await secretOf(box.id)).refreshToken).toBe(grant.refreshToken);
    expect((await mailboxOf(box.id)).status).toBe("active");
  });
});

describe("the callback route", () => {
  test("19. no session cookie: 303 /login, the state row stays, the provider is not called", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    const res = await callback(appOf(), null, "google", query);
    expect(locationOf(res)).toBe("/login");
    expect(await stateRows()).toHaveLength(1);
    expect(fake.calls).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
    // An unknown session cookie is no session either.
    expect(locationOf(await callback(appOf(), "no-such-session", "google", query))).toBe("/login");
    expect(await stateRows()).toHaveLength(1);
  });

  test("20. login CSRF: the callback URL of user A in the session of user B is refused; A's row stays, nothing is redeemed", async () => {
    await enable("google");
    const address = addressOf();
    const mine = await signIn("google", { address, userId: org.ownerId });
    // Another owner of the same organization; and the owner of another organization.
    for (const cookie of ["owner2", "other"]) {
      const res = await callback(appOf(), cookie, "google", mine.query);
      expect(locationOf(res)).toBe("/mailboxes?oauth=oauth_state_invalid");
      expect(await stateRows()).toHaveLength(1);
      expect(fake.calls).toHaveLength(0);
      expect(await mailboxRows(address)).toHaveLength(0);
    }
    // The real owner still finishes the flow with the same URL.
    expect(resultOf(await callback(appOf(), "owner", "google", mine.query)).get("oauth")).toBe("connected");
  });

  test("20b. the query never names the user, the organization or the mailbox: extra parameters are ignored", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    const extra = {
      ...query,
      org: org.otherOrgId,
      org_id: org.otherOrgId,
      orgId: org.otherOrgId,
      user: org.otherOwnerId,
      user_id: org.otherOwnerId,
      userId: org.otherOwnerId,
      mailbox: randomUUID(),
      mailbox_id: randomUUID(),
      mailboxId: randomUUID(),
    };
    expect(resultOf(await callback(appOf(), "owner", "google", extra)).get("oauth")).toBe("connected");
    expect(await mailboxRows(address)).toHaveLength(1);
    const other = await db.selectFrom("mailboxes").select("id").where("org_id", "=", org.otherOrgId).execute();
    expect(other).toHaveLength(0);
  });

  test("21. an owner demoted since the start gets oauth_failed: nothing is redeemed or stored", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address, userId: org.assistantId });
    expect(locationOf(await callback(appOf(), "assistant", "google", query))).toBe("/mailboxes?oauth=oauth_failed");
    expect(fake.calls).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("22. a suspended organization: oauth_failed, nothing is redeemed or stored", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(locationOf(await callback(appOf({ suspended: true }), "owner", "google", query))).toBe(
      "/mailboxes?oauth=oauth_failed"
    );
    expect(fake.calls).toHaveLength(0);
    expect(await mailboxRows(address)).toHaveLength(0);
  });

  test("23. an unknown provider and a provider that is not configured give a 303, never JSON", async () => {
    const { query } = await signIn("google", { address: addressOf() });
    const unknown = await callback(appOf(), "owner", "yahoo", query);
    expect(locationOf(unknown)).toBe("/mailboxes?oauth=oauth_failed");
    expect(unknown.headers.get("content-type") ?? "").not.toContain("json");
    const none = appOf({ extras: { mailOAuthClients: {} } });
    expect(locationOf(await callback(none, "owner", "google", query))).toBe("/mailboxes?oauth=not_configured");
  });

  test("24. the provider answers an error: oauth_cancelled, and the state is consumed", async () => {
    const { state } = await signIn("google", { address: addressOf() });
    const res = await callback(appOf(), "owner", "google", { error: "access_denied", state });
    expect(locationOf(res)).toBe("/mailboxes?oauth=oauth_cancelled");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await stateRows()).toHaveLength(0);
  });

  test("25. the route enters the tenant scope itself: the login runs in the scope of the session's organization; none stays behind", async () => {
    await enable("google");
    const { query } = await signIn("google", { address: addressOf() });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    expect(login.imap.map((entry) => entry.scope)).toEqual([org.orgId]);
    expect(currentTenantScope()).toBeNull();
  });

  test("26. a throw inside the route is still a 303 with oauth_failed; the log line holds the error name only", async () => {
    await enable("google");
    const { query } = await signIn("google", { address: addressOf() });
    const secret = "tok-should-not-appear-1234";
    const res = await callback(
      appOf({ failSuspendedRead: new Error(`db-said-${secret}-${query.code}`) }),
      "owner",
      "google",
      query
    );
    expect(locationOf(res)).toBe("/mailboxes?oauth=oauth_failed");
    const lines = logLines.join("\n");
    expect(lines).toContain("oauth_callback_failed");
    expect(lines).not.toContain(secret);
    expect(lines).not.toContain(query.code ?? "no");
  });

  test("27. a replay of a used callback URL: oauth_state_invalid, one mailbox", async () => {
    await enable("google");
    const address = addressOf();
    const { query } = await signIn("google", { address });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("connected");
    const again = await callback(appOf(), "owner", "google", query);
    expect(locationOf(again)).toBe("/mailboxes?oauth=oauth_state_invalid");
    expect(await mailboxRows(address)).toHaveLength(1);
  });
});

describe("secrets never leave", () => {
  test("28. canary: no code, state, token, client secret or ID token in a log line, a Location header, a body, an audit row or an error", async () => {
    await enable("google");
    await enable("microsoft");
    const seen: string[] = [];
    const secretsSeen: string[] = [fake.clientSecret];
    const track = (signed: SignedIn) => secretsSeen.push(signed.code, signed.state);

    // Connect with every outcome that touches the tokens.
    const ok = await signIn("google", { address: addressOf("ok") });
    track(ok);
    seen.push(...(await collect(await callback(appOf(), "owner", "google", ok.query))));

    const consent = await signIn("microsoft", { address: addressOf("consent") });
    track(consent);
    fake.failNextRefresh({
      status: 400,
      error: "invalid_grant",
      aadsts: 65001,
      description: `AADSTS65001: ${consent.code} ${consent.state}`,
    });
    seen.push(...(await collect(await callback(appOf(), "owner", "microsoft", consent.query))));

    const refused = await signIn("google", { address: addressOf("refused") });
    track(refused);
    login.refuseImap = true;
    seen.push(...(await collect(await callback(appOf(), "owner", "google", refused.query))));
    login.refuseImap = false;

    const rotated = await signIn("microsoft", { address: addressOf("rotated") });
    track(rotated);
    seen.push(...(await collect(await callback(appOf(), "owner", "microsoft", rotated.query))));

    // A login stub that throws an error whose message holds the access token it was given.
    const thrown = await signIn("google", { address: addressOf("thrown") });
    track(thrown);
    const app = appOf({
      extras: {
        mailOAuthLogin: {
          ...extrasOf().mailOAuthLogin,
          openProvider: async (opts) => {
            throw new Error(`login failed with ${opts.auth.kind === "oauth" ? opts.auth.accessToken : ""}`);
          },
        },
      },
    });
    seen.push(...(await collect(await callback(app, "owner", "google", thrown.query))));

    // Reconnect, a replay, a CSRF attempt and a cancel.
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const again = await signIn("google", { address: box.address, mailboxId: box.id });
    track(again);
    seen.push(...(await collect(await callback(appOf(), "owner", "google", again.query))));
    seen.push(...(await collect(await callback(appOf(), "owner", "google", again.query))));
    const csrf = await signIn("google", { address: addressOf("csrf") });
    track(csrf);
    seen.push(...(await collect(await callback(appOf(), "other", "google", csrf.query))));
    const cancel = await signIn("google", { address: addressOf("cancel") });
    track(cancel);
    seen.push(
      ...(await collect(
        await callback(appOf(), "owner", "google", {
          error: "access_denied",
          error_description: `${cancel.code} ${cancel.state}`,
          state: cancel.state,
        })
      ))
    );

    secretsSeen.push(...fake.issuedRefreshTokens);
    const audit = await db.selectFrom("audit_log").selectAll().where("org_id", "=", org.orgId).execute();
    const text = [...logLines, ...seen, inspect(audit, { depth: 10 })].join("\n");
    expect(secretsSeen.filter((value) => value !== "").length).toBeGreaterThan(15);
    expect(audit.length).toBeGreaterThan(2);
    expect(logLines.length).toBeGreaterThan(0);
    for (const value of secretsSeen) {
      expect({ value: value.slice(0, 8), leaked: value !== "" && text.includes(value) }).toEqual({
        value: value.slice(0, 8),
        leaked: false,
      });
    }
    // The access tokens the fake issued (`at-<n>-<hex>`) and the thrown access token, and any ID token.
    expect(text).not.toMatch(/\bat-\d+-[0-9a-f]{12}\b/);
    expect(text).not.toMatch(/eyJ|id_token|client_secret|refresh_token/);
    // The stored secret is encrypted: the refresh token is not in the credentials row.
    const stored = await db
      .selectFrom("mailbox_credentials")
      .select("encrypted_secret")
      .where("org_id", "=", org.orgId)
      .execute();
    for (const row of stored) {
      for (const token of fake.issuedRefreshTokens) expect(row.encrypted_secret).not.toContain(token);
    }
  });

  /** The Location header and the body of an answer: both must be free of secrets. */
  async function collect(res: Response): Promise<string[]> {
    expect(res.status).toBe(303);
    return [res.headers.get("location") ?? "", await res.text(), inspect(Object.fromEntries(res.headers))];
  }

  test("29. two organizations hold a mailbox of one address: a Reconnect of one never changes the other", async () => {
    const address = addressOf("twin");
    const mine = await seedMailbox({ address, status: "auth_error", reason: "oauth_expired" });
    const theirs = await seedMailbox({ orgId: org.otherOrgId, address, status: "auth_error", reason: "oauth_expired" });
    const { query } = await signIn("google", { address, mailboxId: mine.id });
    expect(resultOf(await callback(appOf(), "owner", "google", query)).get("oauth")).toBe("reconnected");
    expect(await mailboxOf(theirs.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_expired" });
    expect((await secretOf(theirs.id)).refreshToken).toBe(theirs.refreshToken);
    const { rows } = await sql<{ n: string }>`
      select count(*) as n from audit_log where org_id = ${org.otherOrgId} and event = 'mailbox.reconnected'`.execute(
      db
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("the secret store", () => {
  const sample = (refreshToken: string) => ({
    v: 1 as const,
    provider: "google" as const,
    refreshToken,
    tenantId: null,
    scopes: ["s"],
  });

  test("30. save then read; the secret is sealed with the AAD of its mailbox and the kind stays oauth", async () => {
    const box = await seedMailbox();
    const other = await seedMailbox();
    await db.transaction().execute((tx) => saveOAuthSecret(tx, secrets, ctxA(), box.id, sample("saved-token")));
    expect(await db.transaction().execute((tx) => readOAuthSecret(tx, secrets, ctxA(), box.id))).toEqual(
      sample("saved-token")
    );
    // The ciphertext of one mailbox does not open under another mailbox id.
    const row = await credentialsOf(box.id);
    expect(() =>
      secrets.decrypt(
        { ciphertext: row?.encrypted_secret ?? "", keyVersion: row?.key_version ?? 0 },
        `mailbox:${other.id}`
      )
    ).toThrow();
    expect(row?.secret_kind).toBe("oauth");
  });

  test("31. read refuses a password secret and a missing row; save of a missing row throws; another organization sees nothing", async () => {
    const password = await seedMailbox({ password: true });
    await expect(db.transaction().execute((tx) => readOAuthSecret(tx, secrets, ctxA(), password.id))).rejects.toThrow(
      "not an oauth secret"
    );
    const missing = randomUUID();
    await expect(db.transaction().execute((tx) => readOAuthSecret(tx, secrets, ctxA(), missing))).rejects.toThrow(
      "no stored secret"
    );
    await expect(
      db.transaction().execute((tx) => saveOAuthSecret(tx, secrets, ctxA(), missing, sample("x")))
    ).rejects.toThrow("no stored secret");
    const mine = await seedMailbox();
    await expect(
      db.transaction().execute((tx) => readOAuthSecret(tx, secrets, { orgId: org.otherOrgId }, mine.id))
    ).rejects.toThrow("no stored secret");
    await expect(
      db.transaction().execute((tx) => saveOAuthSecret(tx, secrets, { orgId: org.otherOrgId }, mine.id, sample("x")))
    ).rejects.toThrow("no stored secret");
    expect((await secretOf(mine.id)).refreshToken).toBe(mine.refreshToken);
  });

  test("32. a failure after the save rolls the secret back: the replacement is atomic", async () => {
    const box = await seedMailbox();
    await expect(
      withMailboxOAuthLock(db, box.id, async (tx) => {
        await saveOAuthSecret(tx, secrets, ctxA(), box.id, sample("half-written"));
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect((await secretOf(box.id)).refreshToken).toBe(box.refreshToken);
  });

  test("33. the lock holds two writers of one mailbox apart (two connections) and lets another mailbox through", async () => {
    const one = await seedMailbox();
    const two = await seedMailbox();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const order: string[] = [];
    const first = withMailboxOAuthLock(db, one.id, async () => {
      acquired();
      await held;
      order.push("first");
    });
    await holding;
    const second = withMailboxOAuthLock(db, one.id, async () => {
      order.push("second");
    });
    // Another mailbox is not blocked.
    await withMailboxOAuthLock(db, two.id, async () => {
      order.push("other");
    });
    expect(order).toEqual(["other"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["other", "first", "second"]);
  });
});
