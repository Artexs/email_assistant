import { randomBytes, randomUUID } from "node:crypto";

import { expect } from "bun:test";

import {
  createMailOAuthClients,
  createOAuthState,
  MailAuthError,
  openImapProvider,
  verifySmtpLogin,
  type ApplyGrantDeps,
  type MailOAuthClients,
  type MailOAuthProvider,
  type OAuthGrant,
  type OAuthStart,
} from "../../src/modules/mail";
import { decodeOAuthSecret, encodeOAuthSecret } from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { currentTenantScope } from "../../src/platform/db";
import type { Db } from "../../src/platform/db";
import { apiPublicRouters, type WebExtras } from "../../src/web";
import { type FakeMailOAuth } from "../fake-mail-oauth";

import { testCapabilities } from "./fixtures";
import { as, TEST_ORIGIN, webTestApp, type WebOrg } from "./web-helpers";

// Connect and Reconnect of an OAuth mailbox and the callback route. The token endpoint is the fake token server; the mail
// login runs against GreenMail (auth off: it takes any token), or a stub that refuses. Rows are committed, because the state store and
// the Reconnect lock run their own transactions. No real provider call.

export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

export const MAIL_HOST = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
export const IMAP_PORT = Number(process.env.TEST_IMAP_PORT ?? "3143");
export const SMTP_PORT = Number(process.env.TEST_SMTP_PORT ?? "3025");
export const HOSTS = {
  imap: { host: MAIL_HOST, port: IMAP_PORT },
  smtp: { host: MAIL_HOST, port: SMTP_PORT, security: "tls" as const },
};
export const GOOGLE_MAIL = "https://mail.google.com/";

// What the login stub saw, and what it refuses.
export const login = {
  imap: [] as { user: string; host: string; port: number; accessToken: string; scope: string | null }[],
  smtp: [] as { user: string; accessToken: string }[],
  refuseImap: false,
  refuseSmtp: false,
  /** The one user the access token belongs to; any other login user is refused. Null: no check. */
  accountUser: null as string | null,
  throwImap: null as Error | null,
};
export const dropped: string[] = [];

export const testConfig = () =>
  loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: TEST_ORIGIN,
    WEB_AUTH_SECRET: "x".repeat(32),
  });

export function makeClients(fake: FakeMailOAuth): MailOAuthClients {
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

export const locationOf = (res: Response): string => {
  expect(res.status).toBe(303);
  return res.headers.get("location") ?? "";
};
export const resultOf = (res: Response): URLSearchParams => new URL(locationOf(res), "http://x.test").searchParams;

export interface SignedIn {
  query: Record<string, string>;
  state: string;
  code: string;
  userId: string;
}

export interface SeedOpts {
  provider?: MailOAuthProvider;
  address?: string;
  status?: string;
  reason?: string | null;
  orgId?: string;
  password?: boolean;
  refreshToken?: string;
}

export interface OAuthConnectContext {
  db: Db;
  org: () => WebOrg;
  fake: () => FakeMailOAuth;
  clients: () => MailOAuthClients;
  secondOwnerId: () => string;
}

// The helpers that read the state of the file that calls them (its organization, its fake token server, its clients).
export function makeOAuthConnectKit(c: OAuthConnectContext) {
  const { db } = c;

  const extrasOf = (over: Partial<WebExtras> = {}): WebExtras => ({
    secrets,
    actionsScope: { kind: "off" },
    sendScope: { kind: "off" },
    botUsername: null,
    mailOAuthClients: c.clients(),
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

  function appOf(over: { extras?: Partial<WebExtras>; suspended?: boolean; failSuspendedRead?: Error } = {}) {
    return webTestApp({
      db,
      sessions: {
        owner: c.org().ownerId,
        assistant: c.org().assistantId,
        other: c.org().otherOwnerId,
        owner2: c.secondOwnerId(),
      },
      routers: () => undefined,
      publicRouters: apiPublicRouters(testConfig(), db, extrasOf(over.extras), () => new Date()),
      isOrgSuspended: async () => {
        if (over.failSuspendedRead !== undefined) throw over.failSuspendedRead;
        return over.suspended === true;
      },
    });
  }

  const ctxA = () => ({ orgId: c.org().orgId });
  const addressOf = (label = "u"): string => `${label}-${randomUUID()}@x.test`;
  const enable = (provider: MailOAuthProvider, flag = `mail_oauth_${provider}`) =>
    setOrgFeature(db, ctxA(), { flag, enabled: true, actor: c.org().ownerId, now: new Date() });

  /** A sign-in the callback can finish: a state row of the user and a fake code bound to its challenge. */
  async function signIn(
    provider: MailOAuthProvider,
    who: { address: string; userId?: string; mailboxId?: string | null; orgId?: string }
  ): Promise<SignedIn> {
    const userId = who.userId ?? c.org().ownerId;
    const start: OAuthStart = { provider, userId, mailboxId: who.mailboxId ?? null };
    const made = await createOAuthState(db, secrets, { orgId: who.orgId ?? c.org().orgId }, start, new Date());
    const code = c.fake().code({ provider, address: who.address, codeChallenge: made.codeChallenge });
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

  const mailboxRows = (address: string) =>
    db.selectFrom("mailboxes").selectAll().where("org_id", "=", c.org().orgId).where("address", "=", address).execute();
  const stateRows = () =>
    db.selectFrom("mailbox_oauth_states").selectAll().where("org_id", "=", c.org().orgId).execute();
  const auditOf = (event: string) =>
    db.selectFrom("audit_log").selectAll().where("org_id", "=", c.org().orgId).where("event", "=", event).execute();
  const credentialsOf = (mailboxId: string) =>
    db.selectFrom("mailbox_credentials").selectAll().where("mailbox_id", "=", mailboxId).executeTakeFirst();
  const secretOf = async (mailboxId: string) => {
    const row = await credentialsOf(mailboxId);
    if (row === undefined) throw new Error("no credentials");
    return decodeOAuthSecret(
      secrets.decrypt({ ciphertext: row.encrypted_secret, keyVersion: row.key_version }, `mailbox:${mailboxId}`)
    );
  };

  /** A mailbox at the local mail server, with an `oauth` secret (or a password secret). */
  async function seedMailbox(opts: SeedOpts = {}): Promise<{ id: string; address: string; refreshToken: string }> {
    const provider = opts.provider ?? "google";
    const orgId = opts.orgId ?? c.org().orgId;
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

  const mailboxOf = (id: string) =>
    db.selectFrom("mailboxes").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  /** A grant for `applyOAuthGrant` called by hand (no route). */
  function grantOf(
    provider: MailOAuthProvider,
    address: string,
    mailboxId: string | null,
    over: Partial<OAuthGrant> = {}
  ): OAuthGrant {
    return {
      start: { provider, userId: c.org().ownerId, mailboxId },
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
      clients: c.clients(),
      openProvider: extras.mailOAuthLogin?.openProvider ?? openImapProvider,
      verifySmtp: extras.mailOAuthLogin?.verifySmtp ?? verifySmtpLogin,
      oauthTokens: { drop: (mailboxId) => void dropped.push(mailboxId) },
      now: () => new Date(),
    };
  };

  return {
    extrasOf,
    appOf,
    ctxA,
    addressOf,
    enable,
    signIn,
    callback,
    mailboxRows,
    stateRows,
    auditOf,
    credentialsOf,
    secretOf,
    seedMailbox,
    mailboxOf,
    grantOf,
    depsOf,
  };
}
