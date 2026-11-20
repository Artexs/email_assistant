import { format } from "node:util";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import { createOAuthTokens, MailAuthError, OAuthGrantError, type MailOAuthClients } from "../../src/modules/mail";
import { HardError, SoftError } from "../../src/platform/errors";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testDb } from "./helpers";
import { grantCases, makeOAuthRefreshKit, secrets } from "./mail-oauth-refresh-helpers";
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
  advance,
  makeClients,
  tokensOf,
  ctxA,
  ctxB,
  refreshCalls,
  linesOf,
  seedMailbox,
  mailboxOf,
  storedToken,
} = makeOAuthRefreshKit({ db, org: () => org, fake: () => fake, clients: () => clients, logLines: () => logLines });

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
