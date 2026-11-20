import { format, inspect } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { sql } from "kysely";

import {
  applyOAuthGrant,
  MailAuthError,
  openMailboxProvider,
  type ApplyGrantDeps,
  type MailOAuthClients,
  type MailOAuthProvider,
  type MailSender,
  type OAuthGrant,
  type OAuthTokens,
  type SmtpConnectOptions,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { saveOAuthSecret, withMailboxOAuthLock } from "../../src/modules/mail/oauth/secret-store";
import { lockMailbox } from "../../src/modules/mail/repo";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testDb } from "./helpers";
import { type Box, makeOAuthRefreshKit, secrets, VERIFIER } from "./mail-oauth-refresh-helpers";
import { webOrg, type WebOrg } from "./web-helpers";

const db = testDb();

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

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
  resetClock();
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

const {
  resetClock,
  now,
  makeClients,
  tokensOf,
  ctxA,
  refreshCalls,
  seedMailbox,
  mailboxOf,
  storedToken,
  syncWith,
  script,
} = makeOAuthRefreshKit({ db, org: () => org, fake: () => fake, clients: () => clients, logLines: () => logLines });

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
