import { randomBytes, randomUUID } from "node:crypto";

import {
  createMailOAuthClients,
  createMailSyncJob,
  createOAuthTokens,
  type AuthErrorReason,
  type ImapConnectOptions,
  type MailOAuthClients,
  type MailOAuthProvider,
  type MailProvider,
  type OAuthTokens,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { decodeOAuthSecret, encodeOAuthSecret } from "../../src/modules/mail/oauth/secret-store";
import { insertCredentials, insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { Db } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";
import { type FakeMailOAuth } from "../fake-mail-oauth";

import { testCapabilities } from "./fixtures";
import { type WebOrg } from "./web-helpers";

// The token store (`createOAuthTokens`), the login retry of `openMailboxProvider` and the status with a reason.
// The token endpoint is the fake token server. Rows are committed: the refresh runs its own transaction on the pool, so it must see them.
// The sync job lists the mailboxes of the whole database; a mailbox that is not a test mailbox gets a soft error and no status change.

export const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
export const VERIFIER = "v".repeat(43);

export const HOSTS = {
  imap: { host: "127.0.0.1", port: 3143 },
  smtp: { host: "127.0.0.1", port: 3025, security: "tls" as const },
};

export interface Box {
  id: string;
  address: string;
  refreshToken: string;
}

export interface SeedOpts {
  provider?: MailOAuthProvider;
  orgId?: string;
  password?: boolean;
  status?: string;
  reason?: AuthErrorReason | null;
}

// The sync job: its mailboxes are the committed rows of the database; a stub opens only the test mailboxes.
export interface Script {
  user: string;
  tokens: string[];
  /** The error of the nth open (1-based), or null to open. */
  failOn(attempt: number): Error | null;
}

export const grantCases: {
  name: string;
  provider: MailOAuthProvider;
  aadsts?: number;
  error: string;
  reason: AuthErrorReason;
}[] = [
  { name: "AADSTS 700082", provider: "microsoft", aadsts: 700082, error: "invalid_grant", reason: "oauth_expired" },
  { name: "AADSTS 50173", provider: "microsoft", aadsts: 50173, error: "invalid_grant", reason: "oauth_revoked" },
  {
    name: "AADSTS 65001",
    provider: "microsoft",
    aadsts: 65001,
    error: "invalid_grant",
    reason: "admin_consent_required",
  },
  { name: "Google invalid_grant", provider: "google", error: "invalid_grant", reason: "oauth_expired" },
];

export const CLOCK_START = "2026-11-15T10:00:00Z";

export interface OAuthRefreshContext {
  db: Db;
  org: () => WebOrg;
  fake: () => FakeMailOAuth;
  clients: () => MailOAuthClients;
  logLines: () => string[];
}

// The helpers that read the state of the file that calls them (its organization, its fake token server, its clients, its log lines)
// and the clock of its token store.
export function makeOAuthRefreshKit(c: OAuthRefreshContext) {
  const { db } = c;
  let clock = new Date(CLOCK_START);
  const now = () => clock;
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const resetClock = () => {
    clock = new Date(CLOCK_START);
  };

  const configOf = (server: FakeMailOAuth = c.fake()) =>
    loadConfig({
      DATABASE_URL: "postgres://x",
      CREDENTIALS_KEY: randomBytes(32).toString("base64"),
      WEB_BASE_URL: "http://127.0.0.1:8081",
      WEB_AUTH_SECRET: "x".repeat(32),
      MAIL_OAUTH_MICROSOFT_CLIENT_ID: server.clientId,
      MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: server.clientSecret,
      MAIL_OAUTH_GOOGLE_CLIENT_ID: server.clientId,
      MAIL_OAUTH_GOOGLE_CLIENT_SECRET: server.clientSecret,
    });

  function makeClients(timeoutMs?: number, server: FakeMailOAuth = c.fake()): MailOAuthClients {
    return createMailOAuthClients(configOf(server), {
      specs: server.specs(HOSTS),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  }

  const tokensOf = (over: Partial<Parameters<typeof createOAuthTokens>[0]> = {}): OAuthTokens =>
    createOAuthTokens({ pool: db, secrets, clients: c.clients(), now, ...over });

  const ctxA = () => ({ orgId: c.org().orgId });
  const ctxB = () => ({ orgId: c.org().otherOrgId });
  const addressOf = (label = "u"): string => `${label}-${randomUUID()}@x.test`;
  const refreshCalls = () => c.fake().calls.filter((call) => call.grant === "refresh_token");
  const linesOf = (event: string) => c.logLines().filter((line) => line.includes(event));

  /** A mailbox with an `oauth` secret that the fake token server knows (a real redeem), or a password secret. */
  async function seedMailbox(opts: SeedOpts = {}): Promise<Box> {
    const provider = opts.provider ?? "google";
    const orgId = opts.orgId ?? c.org().orgId;
    const id = randomUUID();
    const address = addressOf("seed");
    let refreshToken = "a-password";
    if (opts.password !== true) {
      const client = c.clients()[provider];
      if (client === undefined) throw new Error("no client");
      const answer = await client.redeemCode(c.fake().code({ provider, address }), VERIFIER);
      refreshToken = answer.refreshToken ?? "";
      c.fake().calls.length = 0;
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

  const mailboxOf = (id: string) =>
    db.selectFrom("mailboxes").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  const storedToken = async (id: string): Promise<string> => {
    const row = await db
      .selectFrom("mailbox_credentials")
      .selectAll()
      .where("mailbox_id", "=", id)
      .executeTakeFirstOrThrow();
    return decodeOAuthSecret(
      secrets.decrypt({ ciphertext: row.encrypted_secret, keyVersion: row.key_version }, `mailbox:${id}`)
    ).refreshToken;
  };

  function syncWith(tokens: OAuthTokens | undefined, scripts: Script[]) {
    const providers = new Map<string, MailProvider>();
    return createMailSyncJob({
      db,
      secrets,
      ...(tokens === undefined ? {} : { oauthTokens: tokens }),
      openProvider: async (opts: ImapConnectOptions) => {
        const script = scripts.find((candidate) => candidate.user === opts.user);
        if (script === undefined) throw new SoftError("not a test mailbox");
        script.tokens.push(opts.auth.kind === "oauth" ? opts.auth.accessToken : "password");
        const failure = script.failOn(script.tokens.length);
        if (failure !== null) throw failure;
        const provider = providers.get(opts.user) ?? createFakeMailProvider({ uidValidity: 7 });
        providers.set(opts.user, provider);
        return provider;
      },
      isOwnActionId: async () => false,
      sentOriginOf: async () => null,
      now,
    });
  }

  const script = (box: Box, failOn: Script["failOn"] = () => null): Script => ({
    user: box.address,
    tokens: [],
    failOn,
  });

  return {
    now,
    advance,
    resetClock,
    makeClients,
    tokensOf,
    ctxA,
    ctxB,
    addressOf,
    refreshCalls,
    linesOf,
    seedMailbox,
    mailboxOf,
    storedToken,
    syncWith,
    script,
  };
}
