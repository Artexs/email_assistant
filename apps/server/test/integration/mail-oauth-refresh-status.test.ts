import { randomBytes, randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type {
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from "kysely";
import { sql } from "kysely";

import {
  applyOAuthGrant,
  createMailOAuthClients,
  createMailSyncJob,
  createOAuthTokens,
  MailAuthError,
  OAuthGrantError,
  openMailboxProvider,
  updateMailboxPassword,
  type ApplyGrantDeps,
  type AuthErrorReason,
  type ImapConnectOptions,
  type MailOAuthClients,
  type MailOAuthProvider,
  type MailProvider,
  type MailSender,
  type OAuthGrant,
  type OAuthTokens,
  type SmtpConnectOptions,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import {
  decodeOAuthSecret,
  encodeOAuthSecret,
  saveOAuthSecret,
  withMailboxOAuthLock,
} from "../../src/modules/mail/oauth/secret-store";
import {
  changeMailboxStatus,
  insertCredentials,
  insertInboxFolder,
  insertMailbox,
  lockMailbox,
  setMailboxStatus,
} from "../../src/modules/mail/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { HardError, SoftError } from "../../src/platform/errors";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { webOrg, type WebOrg } from "./web-helpers";

// The token store (`createOAuthTokens`), the login retry of `openMailboxProvider` and the status with a reason.
// The token endpoint is the fake token server. Rows are committed: the refresh runs its own transaction on the pool, so it must see them.
// The sync job lists the mailboxes of the whole database; a mailbox that is not a test mailbox gets a soft error and no status change.
const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const VERIFIER = "v".repeat(43);

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let clock = new Date("2026-11-15T10:00:00Z");
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];
const now = () => clock;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const configOf = (server: FakeMailOAuth = fake) =>
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

const HOSTS = {
  imap: { host: "127.0.0.1", port: 3143 },
  smtp: { host: "127.0.0.1", port: 3025, security: "tls" as const },
};

function makeClients(timeoutMs?: number, server: FakeMailOAuth = fake): MailOAuthClients {
  return createMailOAuthClients(configOf(server), {
    specs: server.specs(HOSTS),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

const tokensOf = (over: Partial<Parameters<typeof createOAuthTokens>[0]> = {}): OAuthTokens =>
  createOAuthTokens({ pool: db, secrets, clients, now, ...over });

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
  clock = new Date("2026-11-15T10:00:00Z");
  fake.calls.length = 0;
  fake.expiresIn = 3599;
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
});

const ctxA = () => ({ orgId: org.orgId });
const ctxB = () => ({ orgId: org.otherOrgId });
const addressOf = (label = "u"): string => `${label}-${randomUUID()}@x.test`;
const refreshCalls = () => fake.calls.filter((call) => call.grant === "refresh_token");
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
  status?: string;
  reason?: AuthErrorReason | null;
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
    const answer = await client.redeemCode(fake.code({ provider, address }), VERIFIER);
    refreshToken = answer.refreshToken ?? "";
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

const mailboxOf = (id: string) => db.selectFrom("mailboxes").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
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

describe("the access token cache", () => {
  test("1. two calls within a minute make one refresh; the second token is the cached one", async () => {
    const box = await seedMailbox();
    const tokens = tokensOf();
    const first = await tokens.accessToken(ctxA(), box.id, "mail");
    advance(MINUTE_MS);
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).toBe(first);
    expect(refreshCalls()).toHaveLength(1);
  });

  test("2. under 5 minutes left: the next call refreshes; at exactly 5 minutes left the token is still used", async () => {
    const box = await seedMailbox();
    const tokens = tokensOf();
    fake.expiresIn = 240;
    const first = await tokens.accessToken(ctxA(), box.id, "mail");
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).not.toBe(first);
    expect(refreshCalls()).toHaveLength(2);

    fake.expiresIn = 600;
    const third = await tokens.accessToken(ctxA(), box.id, "mail");
    advance(300_000);
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).toBe(third);
    expect(refreshCalls()).toHaveLength(3);
    advance(1_000);
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).not.toBe(third);
    expect(refreshCalls()).toHaveLength(4);
  });

  test("3. fresh skips the cache", async () => {
    const box = await seedMailbox();
    const tokens = tokensOf();
    const first = await tokens.accessToken(ctxA(), box.id, "mail");
    expect(await tokens.accessToken(ctxA(), box.id, "mail", { fresh: true })).not.toBe(first);
    expect(refreshCalls()).toHaveLength(2);
  });

  test("4. mail and graph have their own entries; drop removes both; the scope of each call follows its resource", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const tokens = tokensOf();
    await tokens.accessToken(ctxA(), box.id, "mail");
    await tokens.accessToken(ctxA(), box.id, "graph");
    await tokens.accessToken(ctxA(), box.id, "mail");
    await tokens.accessToken(ctxA(), box.id, "graph");
    expect(refreshCalls()).toHaveLength(2);
    expect(refreshCalls()[0]?.scope).not.toBe(refreshCalls()[1]?.scope);
    tokens.drop(box.id);
    await tokens.accessToken(ctxA(), box.id, "mail");
    await tokens.accessToken(ctxA(), box.id, "graph");
    expect(refreshCalls()).toHaveLength(4);
  });

  test("5. another organization never gets the cached token of a mailbox, and asks the provider for nothing", async () => {
    const box = await seedMailbox();
    const tokens = tokensOf();
    const own = await tokens.accessToken(ctxA(), box.id, "mail");
    await expect(tokens.accessToken(ctxB(), box.id, "mail")).rejects.toBeInstanceOf(HardError);
    await expect(tokens.accessToken(ctxB(), box.id, "mail", { fresh: true })).rejects.toBeInstanceOf(HardError);
    expect(refreshCalls()).toHaveLength(1);
    expect(await tokens.accessToken(ctxA(), box.id, "mail")).toBe(own);
    // The mailbox of the other organization with the id of this one: still no secret.
    const other = await seedMailbox({ orgId: org.otherOrgId });
    await expect(tokens.accessToken(ctxA(), other.id, "mail")).rejects.toBeInstanceOf(HardError);
    expect(await tokens.accessToken(ctxB(), other.id, "mail")).not.toBe(own);
  });

  test("6. a password mailbox has no OAuth secret: HardError, no provider call", async () => {
    const box = await seedMailbox({ password: true });
    await expect(tokensOf().accessToken(ctxA(), box.id, "mail")).rejects.toBeInstanceOf(HardError);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the refresh", () => {
  test("7. Microsoft rotates: each refresh presents the stored token and stores the new one; an old token is never stored again", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const tokens = tokensOf();
    const stored = [await storedToken(box.id)];
    for (let round = 0; round < 3; round += 1) {
      await tokens.accessToken(ctxA(), box.id, "mail", { fresh: true });
      stored.push(await storedToken(box.id));
    }
    expect(refreshCalls().map((call) => call.refreshToken)).toEqual(stored.slice(0, 3));
    expect(new Set(stored).size).toBe(4);
    expect(stored[3]).toBe(fake.issuedRefreshTokens.at(-1) ?? "");
  });

  test("8. Google keeps its refresh token: the stored secret is the same row content", async () => {
    const box = await seedMailbox({ provider: "google" });
    const before = await db
      .selectFrom("mailbox_credentials")
      .selectAll()
      .where("mailbox_id", "=", box.id)
      .executeTakeFirstOrThrow();
    await tokensOf().accessToken(ctxA(), box.id, "mail", { fresh: true });
    expect(await storedToken(box.id)).toBe(box.refreshToken);
    const after = await db
      .selectFrom("mailbox_credentials")
      .selectAll()
      .where("mailbox_id", "=", box.id)
      .executeTakeFirstOrThrow();
    expect(after.encrypted_secret).toBe(before.encrypted_secret);
  });

  test("9. two concurrent fresh calls make two refreshes, in order; the stored token is the second rotation", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const tokens = tokensOf();
    // The fake keeps every token of the file: count from the one the mailbox holds.
    const base = fake.issuedRefreshTokens.indexOf(box.refreshToken);
    const [a, b] = await Promise.all([
      tokens.accessToken(ctxA(), box.id, "mail", { fresh: true }),
      tokens.accessToken(ctxA(), box.id, "mail", { fresh: true }),
    ]);
    expect(a).not.toBe(b);
    const calls = refreshCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.refreshToken).toBe(box.refreshToken);
    // The second call waited for the lock and read the token the first one saved.
    expect(calls[1]?.refreshToken).toBe(fake.issuedRefreshTokens[base + 1]);
    expect(await storedToken(box.id)).toBe(fake.issuedRefreshTokens[base + 2] ?? "");
  });

  test("10. a refresh that the provider refuses stores nothing and caches nothing", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const tokens = tokensOf();
    fake.failNextRefresh({ status: 400, error: "invalid_grant", aadsts: 70008 });
    await expect(tokens.accessToken(ctxA(), box.id, "mail")).rejects.toBeInstanceOf(MailAuthError);
    expect(await storedToken(box.id)).toBe(box.refreshToken);
    await tokens.accessToken(ctxA(), box.id, "mail");
    expect(refreshCalls()).toHaveLength(2);
  });
});

const grantCases: {
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

describe("a refused grant", () => {
  for (const item of grantCases) {
    test(`11. ${item.name}: MailAuthError with the reason ${item.reason}; every cached token of the mailbox goes`, async () => {
      const box = await seedMailbox({ provider: item.provider });
      const tokens = tokensOf();
      await tokens.accessToken(ctxA(), box.id, "mail");
      if (item.provider === "microsoft") await tokens.accessToken(ctxA(), box.id, "graph");
      const before = refreshCalls().length;
      fake.failNextRefresh({
        status: 400,
        error: item.error,
        ...(item.aadsts === undefined ? {} : { aadsts: item.aadsts }),
      });
      const error = await tokens
        .accessToken(ctxA(), box.id, "mail", { fresh: true })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MailAuthError);
      expect((error as MailAuthError).reason).toBe(item.reason);
      expect(error).not.toBeInstanceOf(OAuthGrantError);
      // The cache is empty: both resources refresh again.
      await tokens.accessToken(ctxA(), box.id, "mail");
      if (item.provider === "microsoft") await tokens.accessToken(ctxA(), box.id, "graph");
      expect(refreshCalls().length - before).toBe(item.provider === "microsoft" ? 3 : 2);
    });
  }
});

describe("faults of the operator and the network", () => {
  test("12. invalid_client: SoftError; one error line with the provider each time; no status change", async () => {
    const box = await seedMailbox({ provider: "google" });
    const tokens = tokensOf();
    for (const round of [1, 2]) {
      fake.failNextRefresh({ status: 401, error: "invalid_client" });
      const error = await tokens.accessToken(ctxA(), box.id, "mail").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SoftError);
      expect(linesOf("mail_oauth_client_invalid")).toHaveLength(round);
    }
    expect(linesOf("mail_oauth_client_invalid")[0]).toContain("google");
    expect((await mailboxOf(box.id)).status).toBe("active");
  });

  test("13. a 5xx answer: SoftError and one warn line (the client logs it), no error line", async () => {
    const box = await seedMailbox({ provider: "google" });
    fake.failNextRefresh({ status: 503, error: "temporarily_unavailable" });
    await expect(tokensOf().accessToken(ctxA(), box.id, "mail")).rejects.toBeInstanceOf(SoftError);
    expect(linesOf("oauth_token_failed")).toHaveLength(1);
    expect(linesOf("mail_oauth_client_invalid")).toHaveLength(0);
  });

  test("14. the provider hangs and the client times out at 200 ms: SoftError, one warn line, nothing changes", async () => {
    const slow = await startFakeMailOAuth();
    try {
      const slowClients = makeClients(200, slow);
      const tokens = createOAuthTokens({ pool: db, secrets, clients: slowClients, now });
      const box = await seedMailbox();
      // The seed above used the shared fake; the slow fake does not know the token: the hang comes first anyway.
      slow.failNextRefresh("timeout");
      const error = await tokens.accessToken(ctxA(), box.id, "mail").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SoftError);
      expect(linesOf("oauth_token_failed")).toHaveLength(1);
      expect(linesOf("oauth_token_failed")[0]).toContain("timeout");
      expect((await mailboxOf(box.id)).status).toBe("active");
    } finally {
      await slow.stop();
    }
  });

  test("15. no client for the provider: SoftError; one error line for each provider and process", async () => {
    const google = await seedMailbox({ provider: "google" });
    const microsoft = await seedMailbox({ provider: "microsoft" });
    const tokens = tokensOf({ clients: {} });
    for (let run = 0; run < 2; run += 1) {
      await expect(tokens.accessToken(ctxA(), google.id, "mail")).rejects.toBeInstanceOf(SoftError);
      await expect(tokens.accessToken(ctxA(), microsoft.id, "mail")).rejects.toBeInstanceOf(SoftError);
    }
    expect(linesOf("mail_oauth_not_configured")).toHaveLength(2);
    expect(linesOf("mail_oauth_not_configured").some((line) => line.includes("google"))).toBe(true);
    expect(linesOf("mail_oauth_not_configured").some((line) => line.includes("microsoft"))).toBe(true);
    expect(fake.calls).toHaveLength(0);
  });
});

// The sync job: its mailboxes are the committed rows of the database; a stub opens only the test mailboxes.
interface Script {
  user: string;
  tokens: string[];
  /** The error of the nth open (1-based), or null to open. */
  failOn(attempt: number): Error | null;
}

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

const script = (box: Box, failOn: Script["failOn"] = () => null): Script => ({ user: box.address, tokens: [], failOn });

describe("the sync job sets the status with its reason", () => {
  for (const item of grantCases) {
    test(`16. ${item.name}: auth_error with auth_reason ${item.reason} in one write`, async () => {
      const box = await seedMailbox({ provider: item.provider });
      fake.failNextRefresh({
        status: 400,
        error: item.error,
        ...(item.aadsts === undefined ? {} : { aadsts: item.aadsts }),
      });
      await syncWith(tokensOf(), [script(box)]).run();
      expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: item.reason });
    });
  }

  test("17. invalid_client leaves the mailbox active with no reason", async () => {
    const box = await seedMailbox();
    fake.failNextRefresh({ status: 401, error: "invalid_client" });
    await syncWith(tokensOf(), [script(box)]).run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
    expect(linesOf("mail_oauth_client_invalid")).toHaveLength(1);
  });

  test("18. a provider without a client: the status stays and the error line comes once for two runs", async () => {
    const box = await seedMailbox();
    const job = syncWith(tokensOf({ clients: {} }), [script(box)]);
    await job.run();
    await job.run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
    expect(linesOf("mail_oauth_not_configured")).toHaveLength(1);
  });

  test("19. a refused login: one fresh refresh, then the second open passes; the mailbox syncs", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const open = script(box, (attempt) => (attempt === 1 ? new MailAuthError("IMAP login failed") : null));
    await syncWith(tokensOf(), [open]).run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
    expect((await mailboxOf(box.id)).last_synced_at).toEqual(now());
    expect(open.tokens).toHaveLength(2);
    expect(open.tokens[0]).not.toBe(open.tokens[1]);
    // One refresh for the first token, one fresh refresh after the refusal.
    expect(refreshCalls()).toHaveLength(2);
  });

  test("20. a login refused twice: auth_error with the reason protocol_disabled", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const open = script(box, () => new MailAuthError("IMAP login failed"));
    await syncWith(tokensOf(), [open]).run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: "protocol_disabled" });
    expect(open.tokens).toHaveLength(2);
    expect(refreshCalls()).toHaveLength(2);
  });

  test("21. a server without XOAUTH2 (imapflow: Unsupported authentication mechanism) is a refusal too", async () => {
    const box = await seedMailbox();
    const unsupported = () =>
      new HardError("IMAP connect failed", { cause: new Error("Unsupported authentication mechanism") });
    await syncWith(tokensOf(), [script(box, unsupported)]).run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: "protocol_disabled" });
  });

  test("22. a dropped connection at the login stays a soft error: no retry, no status change", async () => {
    const box = await seedMailbox();
    const open = script(box, () => new SoftError("IMAP connect: connection error ECONNRESET"));
    await syncWith(tokensOf(), [open]).run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
    expect(open.tokens).toHaveLength(1);
    expect(refreshCalls()).toHaveLength(1);
  });

  test("23. a password mailbox: a refused login gives auth_error with no reason, no retry, no token call", async () => {
    const box = await seedMailbox({ password: true });
    const open = script(box, () => new MailAuthError("IMAP login failed"));
    await syncWith(tokensOf(), [open]).run();
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: null });
    expect(open.tokens).toEqual(["password"]);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("every status writer clears the reason in its own statement", () => {
  const withReason = () => seedMailbox({ status: "auth_error", reason: "oauth_expired" });

  for (const status of ["active", "paused", "host_blocked"] as const) {
    test(`24. setMailboxStatus to ${status} writes auth_reason NULL`, async () => {
      const box = await withReason();
      await setMailboxStatus(db, ctxA(), box.id, status, now());
      expect(await mailboxOf(box.id)).toMatchObject({ status, auth_reason: null });
    });
  }

  test("24b. a reason passed with a status other than auth_error is ignored: NULL, no CHECK failure", async () => {
    const box = await seedMailbox();
    await setMailboxStatus(db, ctxA(), box.id, "active", now(), "oauth_expired");
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
    await setMailboxStatus(db, ctxA(), box.id, "paused", now(), "oauth_expired");
    expect(await mailboxOf(box.id)).toMatchObject({ status: "paused", auth_reason: null });
  });

  test("25. setMailboxStatus auth_error writes the status and the reason in ONE UPDATE", async () => {
    const box = await seedMailbox();
    const statements: string[] = [];
    const spy = {
      transformQuery: ({ node }: PluginTransformQueryArgs): RootOperationNode => {
        if (node.kind === "UpdateQueryNode") statements.push("update");
        return node;
      },
      transformResult: async ({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> => result,
    };
    await setMailboxStatus(db.withPlugin(spy), ctxA(), box.id, "auth_error", now(), "oauth_revoked");
    expect(statements).toHaveLength(1);
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_revoked" });
  });

  test("26. a new reason replaces the old one; auth_error without a reason clears it", async () => {
    const box = await withReason();
    await setMailboxStatus(db, ctxA(), box.id, "auth_error", now(), "protocol_disabled");
    expect((await mailboxOf(box.id)).auth_reason).toBe("protocol_disabled");
    await setMailboxStatus(db, ctxA(), box.id, "auth_error", now());
    expect((await mailboxOf(box.id)).auth_reason).toBeNull();
  });

  test("27. a password mailbox in auth_error keeps the reason NULL, even if a caller passes one (the table CHECK is not reached)", async () => {
    const box = await seedMailbox({ password: true });
    await setMailboxStatus(db, ctxA(), box.id, "auth_error", now(), "oauth_expired");
    expect(await mailboxOf(box.id)).toMatchObject({ status: "auth_error", auth_reason: null });
    await setMailboxStatus(db, ctxA(), box.id, "active", now());
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
  });

  test("28. changeMailboxStatus away from auth_error clears the reason", async () => {
    const box = await withReason();
    expect(await changeMailboxStatus(db, ctxA(), box.id, { from: "auth_error", to: "active", at: now() })).toBe(true);
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
  });

  test("28b. a new password on a password mailbox in auth_error: active, the reason stays NULL", async () => {
    const box = await seedMailbox({ password: true, status: "auth_error" });
    const deps = { db, secrets, openProvider: async () => createFakeMailProvider(), verifySmtp: async () => undefined };
    const result = await updateMailboxPassword(deps, ctxA(), {
      mailboxId: box.id,
      password: "new-password",
      now: now(),
    });
    expect(result).toEqual({ status: "active", reactivated: true });
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
  });

  test("29. the other organization's mailbox is not touched", async () => {
    const mine = await withReason();
    const theirs = await seedMailbox({ orgId: org.otherOrgId, status: "auth_error", reason: "oauth_revoked" });
    await setMailboxStatus(db, ctxA(), theirs.id, "active", now());
    await changeMailboxStatus(db, ctxA(), theirs.id, { from: "auth_error", to: "active", at: now() });
    expect(await mailboxOf(theirs.id)).toMatchObject({ status: "auth_error", auth_reason: "oauth_revoked" });
    expect((await mailboxOf(mine.id)).auth_reason).toBe("oauth_expired");
  });
});

// A Reconnect with a grant the fake knows: a live refresh token from a redeem.
async function grantOf(provider: MailOAuthProvider, box: Box): Promise<OAuthGrant> {
  const client = clients[provider];
  if (client === undefined) throw new Error("no client");
  const answer = await client.redeemCode(fake.code({ provider, address: box.address }), VERIFIER);
  fake.calls.length = 0;
  return {
    start: { provider, userId: org.ownerId, mailboxId: box.id },
    provider,
    address: box.address,
    tenantId: null,
    refreshToken: answer.refreshToken ?? "",
    mailAccessToken: answer.accessToken,
    mailExpiresInSec: answer.expiresInSec,
    scopes: ["new-scope"],
  };
}

const reconnectDeps = (tokens: OAuthTokens): ApplyGrantDeps => ({
  db,
  secrets,
  clients,
  openProvider: async () => createFakeMailProvider(),
  verifySmtp: async () => undefined,
  oauthTokens: tokens,
  now,
});

describe("the lock order of a refresh and a Reconnect", () => {
  test("30. a Reconnect drops the cached token; the next call refreshes with the new refresh token", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const tokens = tokensOf();
    const first = await tokens.accessToken(ctxA(), box.id, "mail");
    const grant = await grantOf("google", box);
    expect(await applyOAuthGrant(reconnectDeps(tokens), ctxA(), grant, org.ownerId)).toMatchObject({
      ok: true,
      code: "reconnected",
    });
    const second = await tokens.accessToken(ctxA(), box.id, "mail");
    expect(second).not.toBe(first);
    expect(refreshCalls().map((call) => call.refreshToken)).toEqual([grant.refreshToken]);
    expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
  });

  test("31. a refresh waits for a Reconnect that holds the advisory lock and the row, then reads the new secret (two connections)", async () => {
    const box = await seedMailbox();
    const tokens = tokensOf();
    const replacement = (await grantOf("google", box)).refreshToken;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const reconnecting = withMailboxOAuthLock(db, box.id, async (tx) => {
      held();
      await gate;
      // The Reconnect order: the advisory lock (taken), then the row.
      expect(await lockMailbox(tx, ctxA(), box.id)).toBeDefined();
      await saveOAuthSecret(tx, secrets, ctxA(), box.id, {
        v: 1,
        provider: "google",
        refreshToken: replacement,
        tenantId: null,
        scopes: ["new-scope"],
      });
    });
    await holding;
    const refreshing = tokens.accessToken(ctxA(), box.id, "mail", { fresh: true });
    await waitForLockWaiter(box.id);
    // No deadlock: the refresh holds no row while it waits for the advisory lock, so the Reconnect takes the row and commits.
    open();
    await reconnecting;
    await refreshing;
    expect(refreshCalls().map((call) => call.refreshToken)).toEqual([replacement]);
  });

  test("32. a row lock of a status writer does not stop the HTTP call; the rotated token waits for the row, with no deadlock", async () => {
    const box = await seedMailbox({ provider: "microsoft" });
    const tokens = tokensOf();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const writer = db.transaction().execute(async (trx) => {
      await lockMailbox(trx, ctxA(), box.id);
      held();
      await gate;
    });
    await holding;
    const refreshing = tokens.accessToken(ctxA(), box.id, "mail", { fresh: true });
    const deadline = Date.now() + 10_000;
    while (refreshCalls().length === 0) {
      if (Date.now() > deadline) throw new Error("the refresh did not reach the provider while a row lock was held");
      await Bun.sleep(25);
    }
    // The provider has rotated the token; the save waits for the row. Nothing is stored yet.
    expect(await storedToken(box.id)).toBe(box.refreshToken);
    release();
    await writer;
    await refreshing;
    expect(await storedToken(box.id)).toBe(fake.issuedRefreshTokens.at(-1) ?? "");
  });

  test("33. a Reconnect and a refresh at the same time (3 rounds): both finish, the stored secret is valid, the mailbox is active", async () => {
    const box = await seedMailbox({ status: "auth_error", reason: "oauth_expired" });
    const tokens = tokensOf();
    for (let round = 0; round < 3; round += 1) {
      const grant = await grantOf("google", box);
      const [result] = await Promise.all([
        applyOAuthGrant(reconnectDeps(tokens), ctxA(), grant, org.ownerId),
        tokens.accessToken(ctxA(), box.id, "mail", { fresh: true }),
      ]);
      expect(result).toMatchObject({ ok: true });
      expect(await mailboxOf(box.id)).toMatchObject({ status: "active", auth_reason: null });
    }
    expect(await storedToken(box.id)).not.toBe(box.refreshToken);
  });
});

describe("openMailboxProvider", () => {
  test("34. the SMTP sender of an OAuth mailbox: a refused login at send time gets the reason protocol_disabled", async () => {
    const box = await seedMailbox();
    const tokens = tokensOf();
    const refused = new MailAuthError("SMTP login failed", {
      cause: Object.assign(new Error("535 5.7.3"), { responseCode: 535 }),
    });
    const sender = createFakeMailSender();
    sender.failNext(refused);
    const opened = await openMailboxProvider(
      {
        db,
        secrets,
        oauthTokens: tokens,
        openProvider: async () => createFakeMailProvider(),
        openSender: async (): Promise<MailSender> => sender,
      },
      ctxA(),
      box.id,
      { withSender: true }
    );
    const error = await opened.sender
      ?.send({ envelope: { from: box.address, to: ["a@x.test"] }, raw: Buffer.from("x") })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailAuthError);
    expect((error as MailAuthError).reason).toBe("protocol_disabled");
  });

  test("35. the SMTP sender of a password mailbox is not wrapped: its refusal stays without a reason", async () => {
    const box = await seedMailbox({ password: true });
    const sender = createFakeMailSender();
    sender.failNext(new MailAuthError("SMTP login failed"));
    const opened = await openMailboxProvider(
      {
        db,
        secrets,
        openProvider: async () => createFakeMailProvider(),
        openSender: async (): Promise<MailSender> => sender,
      },
      ctxA(),
      box.id,
      { withSender: true }
    );
    const error = await opened.sender
      ?.send({ envelope: { from: box.address, to: ["a@x.test"] }, raw: Buffer.from("x") })
      .catch((caught: unknown) => caught);
    expect((error as MailAuthError).reason).toBeUndefined();
  });

  test("36. a 4xx reply to AUTH (421) is a soft login error of the send, never protocol_disabled", async () => {
    const box = await seedMailbox();
    const sender = createFakeMailSender();
    sender.failNext(
      new MailAuthError("SMTP login failed", {
        cause: Object.assign(new Error("421 try later"), { responseCode: 421 }),
      })
    );
    const opened = await openMailboxProvider(
      {
        db,
        secrets,
        oauthTokens: tokensOf(),
        openProvider: async () => createFakeMailProvider(),
        openSender: async (_opts: SmtpConnectOptions): Promise<MailSender> => sender,
      },
      ctxA(),
      box.id,
      { withSender: true }
    );
    const error = (await opened.sender
      ?.send({ envelope: { from: box.address, to: ["a@x.test"] }, raw: Buffer.from("x") })
      .catch((caught: unknown) => caught)) as { name: string; stage: string; soft: boolean };
    expect(error).toMatchObject({ name: "SmtpSendError", stage: "login", soft: true });
  });
});

describe("no token in a log line, an error or an audit row", () => {
  test("37. canary: refresh tokens, access tokens and the client secret stay out of every output", async () => {
    const seen: string[] = [];
    const returned: string[] = [];
    const record = (value: unknown) => seen.push(inspect(value, { depth: 10 }));

    const ms = await seedMailbox({ provider: "microsoft" });
    const gl = await seedMailbox({ provider: "google" });
    const tokens = tokensOf();
    for (const box of [ms, gl]) {
      returned.push(await tokens.accessToken(ctxA(), box.id, "mail"));
      returned.push(await tokens.accessToken(ctxA(), box.id, "mail", { fresh: true }));
    }
    // A provider that echoes the refresh token in its error text.
    for (const item of [
      { box: ms, aadsts: 70008 },
      { box: ms, aadsts: 50173 },
    ]) {
      fake.failNextRefresh({
        status: 400,
        error: "invalid_grant",
        aadsts: item.aadsts,
        description: `AADSTS${item.aadsts}: ${await storedToken(item.box.id)}`,
      });
      record(await tokens.accessToken(ctxA(), item.box.id, "mail", { fresh: true }).catch((caught: unknown) => caught));
    }
    fake.failNextRefresh({ status: 401, error: "invalid_client", description: `bad ${await storedToken(gl.id)}` });
    record(await tokens.accessToken(ctxA(), gl.id, "mail", { fresh: true }).catch((caught: unknown) => caught));
    record(
      await tokensOf({ clients: {} })
        .accessToken(ctxA(), gl.id, "mail")
        .catch((caught: unknown) => caught)
    );
    // A login stub that throws an error whose text holds the access token it got, twice (the retry path).
    const leaky = script(gl, () => new MailAuthError(`login failed with ${returned[3] ?? ""}`));
    await syncWith(tokens, [leaky]).run();
    record(await mailboxOf(gl.id));

    const text = [...logLines, ...seen].join("\n");
    const secretValues = [fake.clientSecret, ...fake.issuedRefreshTokens, ...returned, ...leaky.tokens];
    expect(logLines.length).toBeGreaterThan(5);
    expect(secretValues.length).toBeGreaterThan(8);
    for (const value of secretValues) {
      expect({ value: value.slice(0, 8), leaked: value !== "" && text.includes(value) }).toEqual({
        value: value.slice(0, 8),
        leaked: false,
      });
    }
    expect(text).not.toMatch(/\bat-\d+-[0-9a-f]{12}\b/);
    expect(text).not.toMatch(/\brt-\d+-[0-9a-f]{12}\b/);
    const audit = await db.selectFrom("audit_log").selectAll().where("org_id", "=", org.orgId).execute();
    expect(inspect(audit, { depth: 10 })).not.toMatch(/\b(?:at|rt)-\d+-[0-9a-f]{12}\b/);
  });
});
