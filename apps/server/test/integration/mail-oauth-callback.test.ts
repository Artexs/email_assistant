import { randomBytes, randomUUID } from "node:crypto";
import { format, inspect } from "node:util";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import {
  createMailOAuthClients,
  createOAuthState,
  finishOAuthCallback,
  OAuthSoftError,
  type CallbackResult,
  type MailOAuthClient,
  type MailOAuthClients,
  type MailOAuthProvider,
  type OAuthStart,
  type TokenAnswer,
} from "../../src/modules/mail";
import { OAUTH_STATE_TTL_MS } from "../../src/modules/mail/oauth/state";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { TEST_ORIGIN, webOrg, type WebOrg } from "./web-helpers";

// `finishOAuthCallback` against the fake token server. Rows are committed, because the state store runs its own
// transactions. Every refusal is one code of the closed set; a refusal stores nothing.
const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const HOSTS = {
  imap: { host: "127.0.0.1", port: 1993 },
  smtp: { host: "127.0.0.1", port: 1465, security: "tls" as const },
};
const TID = "11111111-1111-1111-1111-111111111111";
const GOOGLE_MAIL = "https://mail.google.com/";

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

function makeClients(): MailOAuthClients {
  const config = loadConfig({
    DATABASE_URL: "postgres://x",
    CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WEB_BASE_URL: TEST_ORIGIN,
    WEB_AUTH_SECRET: "x".repeat(32),
    MAIL_OAUTH_MICROSOFT_CLIENT_ID: fake.clientId,
    MAIL_OAUTH_MICROSOFT_CLIENT_SECRET: fake.clientSecret,
    MAIL_OAUTH_GOOGLE_CLIENT_ID: fake.clientId,
    MAIL_OAUTH_GOOGLE_CLIENT_SECRET: fake.clientSecret,
  });
  return createMailOAuthClients(config, { specs: fake.specs(HOSTS) });
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
const startOf = (provider: MailOAuthProvider, userId: string, mailboxId: string | null = null): OAuthStart => ({
  provider,
  userId,
  mailboxId,
});
const stateRows = () => db.selectFrom("mailbox_oauth_states").selectAll().where("org_id", "=", org.orgId).execute();

async function addOAuthMailbox(orgId: string, provider: MailOAuthProvider, address: string): Promise<string> {
  const id = randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  await insertInboxFolder(db, { orgId }, id);
  await db.updateTable("mailboxes").set({ oauth_provider: provider }).where("id", "=", id).execute();
  return id;
}

/** A sign-in that the callback can finish: a state row and a fake code bound to its challenge. */
async function signIn(
  provider: MailOAuthProvider,
  who: {
    address: string;
    userId?: string;
    mailboxId?: string | null;
    scopes?: string[];
    emailVerified?: boolean;
    tid?: string;
    claims?: Record<string, unknown>;
    wrongVerifier?: boolean;
    now?: Date;
  }
): Promise<{ query: Record<string, string>; state: string; userId: string }> {
  const userId = who.userId ?? org.ownerId;
  const made = await createOAuthState(
    db,
    secrets,
    ctxA(),
    startOf(provider, userId, who.mailboxId ?? null),
    who.now ?? new Date()
  );
  const code = fake.code({
    provider,
    address: who.address,
    codeChallenge: who.wrongVerifier === true ? "x".repeat(43) : made.codeChallenge,
    ...(who.scopes === undefined ? {} : { scopes: who.scopes }),
    ...(who.emailVerified === undefined ? {} : { emailVerified: who.emailVerified }),
    ...(who.tid === undefined ? {} : { tid: who.tid }),
    ...(who.claims === undefined ? {} : { claims: who.claims }),
  });
  return { query: { code, state: made.state }, state: made.state, userId };
}

const finish = (
  provider: MailOAuthProvider,
  query: Record<string, string>,
  over: { userId?: string; use?: MailOAuthClients; now?: Date; ctx?: { orgId: string } } = {}
): Promise<CallbackResult> =>
  finishOAuthCallback(
    { db, secrets, clients: over.use ?? clients, now: () => over.now ?? new Date() },
    over.ctx ?? ctxA(),
    { provider, userId: over.userId ?? org.ownerId, query }
  );

/** The real client of a provider with some parts replaced: the stub of a token answer the fake cannot make. */
function stubClient(provider: MailOAuthProvider, redeem: MailOAuthClient["redeemCode"]): MailOAuthClients {
  const real = clients[provider];
  if (real === undefined) throw new Error("no client");
  return { [provider]: { ...real, redeemCode: redeem } };
}

const refused = (code: string): CallbackResult => ({ ok: false, code }) as CallbackResult;
const idTokenOf = (claims: Record<string, unknown>): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;

describe("the callback check", () => {
  test("1. Google: the address is lower case, the refresh token is kept, the tenant is null, the scopes are kept", async () => {
    const { query, userId } = await signIn("google", { address: "Ann@X.test" });
    const result = await finish("google", query);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.address).toBe("ann@x.test");
    expect(result.grant.tenantId).toBeNull();
    expect(result.grant.provider).toBe("google");
    expect(result.grant.refreshToken).toBe(fake.issuedRefreshTokens.at(-1) ?? "");
    expect(result.grant.mailAccessToken).toMatch(/^at-/);
    expect(result.grant.mailExpiresInSec).toBe(3599);
    expect(result.grant.scopes).toContain(GOOGLE_MAIL);
    expect(result.grant.start).toEqual(startOf("google", userId));
    // The fake checked the PKCE verifier of the stored state.
    expect(fake.calls.at(-1)?.codeVerifierOk).toBe(true);
  });

  test("2. Microsoft: no email claim, preferred_username gives the address; the tenant is the tid claim", async () => {
    const { query } = await signIn("microsoft", {
      address: "bob@x.test",
      tid: TID,
      claims: { email: undefined },
    });
    const result = await finish("microsoft", query);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.address).toBe("bob@x.test");
    expect(result.grant.tenantId).toBe(TID);
    // With an email claim it wins over preferred_username.
    const second = await signIn("microsoft", { address: "x@x.test", claims: { email: "Carol@X.test" } });
    const other = await finish("microsoft", second.query);
    expect(other.ok && other.grant.address).toBe("carol@x.test");
  });

  test("3. error=access_denied is oauth_cancelled and the state row is gone", async () => {
    const { state } = await signIn("google", { address: "a@x.test" });
    expect(await stateRows()).toHaveLength(1);
    const before = fake.calls.length;
    expect(await finish("google", { error: "access_denied", state })).toEqual(refused("oauth_cancelled"));
    expect(await stateRows()).toHaveLength(0);
    expect(fake.calls.length).toBe(before);
  });

  test("4. consent errors in the query: AADSTS 90094, 90095, 65001 and consent_required", async () => {
    const queries: Record<string, string>[] = [
      { error: "access_denied", error_description: "AADSTS90094: The grant requires admin permission." },
      { error: "access_denied", error_description: "AADSTS90095: Admin consent is required." },
      { error: "invalid_request", error_description: "AADSTS65001: The user has not consented." },
      { error: "consent_required" },
    ];
    for (const query of queries) {
      const { state } = await signIn("microsoft", { address: "a@x.test" });
      expect(await finish("microsoft", { ...query, state })).toEqual(refused("admin_consent_required"));
    }
    const { state } = await signIn("microsoft", { address: "a@x.test" });
    expect(await finish("microsoft", { error: "server_error", error_description: "boom", state })).toEqual(
      refused("oauth_failed")
    );
  });

  test("5. a wrong verifier is oauth_code_invalid; a code from nowhere too", async () => {
    const wrong = await signIn("google", { address: "a@x.test", wrongVerifier: true });
    expect(await finish("google", wrong.query)).toEqual(refused("oauth_code_invalid"));
    expect(fake.calls.at(-1)?.codeVerifierOk).toBe(false);
    const { state } = await signIn("google", { address: "a@x.test" });
    expect(await finish("google", { code: "never-issued", state })).toEqual(refused("oauth_code_invalid"));
  });

  test("5b. the token endpoint says consent is missing (AADSTS 65001, 90094, 90095): admin_consent_required", async () => {
    for (const aadsts of [65001, 90094, 90095]) {
      const { query } = await signIn("microsoft", { address: "a@x.test" });
      fake.failNext({ status: 400, error: "invalid_grant", aadsts });
      expect(await finish("microsoft", query)).toEqual(refused("admin_consent_required"));
    }
  });

  test("5c. a fault of the operator or the network is oauth_failed; the state is gone", async () => {
    for (const failure of [
      { status: 401, error: "invalid_client" },
      { status: 503, error: "temporarily_unavailable" },
    ]) {
      const { query } = await signIn("google", { address: "a@x.test" });
      fake.failNext(failure);
      expect(await finish("google", query)).toEqual(refused("oauth_failed"));
    }
    expect(await stateRows()).toHaveLength(0);
    // A thrown soft error of the client, as a timeout is.
    const { query } = await signIn("google", { address: "a@x.test" });
    const use = stubClient("google", async () => {
      throw new OAuthSoftError("timeout");
    });
    expect(await finish("google", query, { use })).toEqual(refused("oauth_failed"));
  });

  test("6. scopes: no mail scope is oauth_scope_missing; the real answer shapes pass", async () => {
    const missing = await signIn("google", { address: "a@x.test", scopes: ["openid", "email"] });
    expect(await finish("google", missing.query)).toEqual(refused("oauth_scope_missing"));
    // Microsoft names only a Graph scope.
    const graph = await signIn("microsoft", { address: "a@x.test", scopes: ["https://graph.microsoft.com/Mail.Send"] });
    expect(await finish("microsoft", graph.query)).toEqual(refused("oauth_scope_missing"));
    const google = await signIn("google", {
      address: "a@x.test",
      scopes: [GOOGLE_MAIL, "https://www.googleapis.com/auth/userinfo.email", "openid"],
    });
    expect((await finish("google", google.query)).ok).toBe(true);
    for (const scopes of [["IMAP.AccessAsUser.All"], ["https://outlook.office.com/imap.accessasuser.all", "openid"]]) {
      const microsoft = await signIn("microsoft", { address: "a@x.test", scopes });
      expect((await finish("microsoft", microsoft.query)).ok).toBe(true);
    }
    // A scope that only ends alike is not the scope.
    const lookalike = await signIn("microsoft", {
      address: "a@x.test",
      scopes: ["https://x.test/NotIMAP.AccessAsUser.All"],
    });
    expect(await finish("microsoft", lookalike.query)).toEqual(refused("oauth_scope_missing"));
    // The full form must name a Microsoft Outlook host.
    const evil = await signIn("microsoft", {
      address: "a@x.test",
      scopes: ["https://evil.test/IMAP.AccessAsUser.All"],
    });
    expect(await finish("microsoft", evil.query)).toEqual(refused("oauth_scope_missing"));
    const legacy = await signIn("microsoft", {
      address: "a@x.test",
      scopes: ["https://outlook.office365.com/IMAP.AccessAsUser.All"],
    });
    expect((await finish("microsoft", legacy.query)).ok).toBe(true);
  });

  test("7. ID token: email_verified false, another audience, expired, another issuer all give oauth_failed", async () => {
    const unverified = await signIn("google", { address: "a@x.test", emailVerified: false });
    expect(await finish("google", unverified.query)).toEqual(refused("oauth_failed"));
    const aud = await signIn("google", { address: "a@x.test", claims: { aud: "another-client" } });
    expect(await finish("google", aud.query)).toEqual(refused("oauth_failed"));
    const exp = await signIn("google", { address: "a@x.test", claims: { exp: Math.floor(Date.now() / 1000) - 600 } });
    expect(await finish("google", exp.query)).toEqual(refused("oauth_failed"));
    const iss = await signIn("google", { address: "a@x.test", claims: { iss: "https://evil.test" } });
    expect(await finish("google", iss.query)).toEqual(refused("oauth_failed"));
    const tid = await signIn("microsoft", { address: "a@x.test", claims: { tid: undefined } });
    expect(await finish("microsoft", tid.query)).toEqual(refused("oauth_failed"));
    const mismatch = await signIn("microsoft", {
      address: "a@x.test",
      claims: { tid: "22222222-2222-2222-2222-222222222222" },
    });
    expect(await finish("microsoft", mismatch.query)).toEqual(refused("oauth_failed"));
    // The host name of the issuer URL is a path segment too, but it is no tenant.
    const host = await signIn("microsoft", { address: "a@x.test", claims: { tid: "login.microsoftonline.com" } });
    expect(await finish("microsoft", host.query)).toEqual(refused("oauth_failed"));
    // An audience list that holds the client id passes; the exp of 4 minutes ago is inside the skew.
    const list = await signIn("google", {
      address: "a@x.test",
      claims: { aud: ["other", fake.clientId], exp: Math.floor(Date.now() / 1000) - 240 },
    });
    expect((await finish("google", list.query)).ok).toBe(true);
  });

  test("7b. no address, a bad address, no refresh token and no ID token are oauth_failed", async () => {
    const none = await signIn("google", { address: "a@x.test", claims: { email: undefined } });
    expect(await finish("google", none.query)).toEqual(refused("oauth_failed"));
    const bad = await signIn("google", { address: "a@x.test", claims: { email: "not an address" } });
    expect(await finish("google", bad.query)).toEqual(refused("oauth_failed"));
    const long = await signIn("google", { address: "a@x.test", claims: { email: `${"a".repeat(287)}@x.test` } });
    expect(await finish("google", long.query)).toEqual(refused("oauth_failed"));
    const answer: TokenAnswer = {
      accessToken: "at-stub",
      expiresInSec: 3600,
      refreshToken: "rt-stub",
      scopes: [GOOGLE_MAIL],
      idToken: idTokenOf({
        iss: "https://accounts.google.com",
        aud: fake.clientId,
        exp: Math.floor(Date.now() / 1000) + 300,
        email: "a@x.test",
        email_verified: true,
      }),
    };
    const base = (over: Partial<TokenAnswer>) => stubClient("google", async () => ({ ...answer, ...over }));
    // The stub answer is valid as it is: only the one change below makes it fail.
    const fine = await signIn("google", { address: "a@x.test" });
    expect((await finish("google", fine.query, { use: base({}) })).ok).toBe(true);
    for (const over of [{ refreshToken: null }, { idToken: null }, { idToken: "not-a-jwt" }, { idToken: "a.b.c" }]) {
      const { query } = await signIn("google", { address: "a@x.test" });
      expect(await finish("google", query, { use: base(over) })).toEqual(refused("oauth_failed"));
    }
  });

  test("7c. no code in the query is oauth_failed; the state is consumed", async () => {
    const { state } = await signIn("google", { address: "a@x.test" });
    expect(await finish("google", { state })).toEqual(refused("oauth_failed"));
    expect(await stateRows()).toHaveLength(0);
  });

  test("8. the same query twice: the second is oauth_state_invalid and the fake saw one redeem", async () => {
    const { query } = await signIn("google", { address: "a@x.test" });
    const before = fake.calls.length;
    expect((await finish("google", query)).ok).toBe(true);
    expect(await finish("google", query)).toEqual(refused("oauth_state_invalid"));
    expect(fake.calls.length - before).toBe(1);
  });

  test("8b. no state, a state that is no value of ours: oauth_state_invalid, and the provider is not called", async () => {
    const before = fake.calls.length;
    expect(await finish("google", { code: "c" })).toEqual(refused("oauth_state_invalid"));
    expect(await finish("google", { code: "c", state: "" })).toEqual(refused("oauth_state_invalid"));
    expect(await finish("google", { code: "c", state: "x".repeat(43) })).toEqual(refused("oauth_state_invalid"));
    expect(fake.calls.length).toBe(before);
  });

  test("9. Reconnect for ann@x.test: the provider answers eve@x.test: oauth_wrong_account; the same address in other case passes", async () => {
    const mailboxId = await addOAuthMailbox(org.orgId, "google", "Ann@X.test");
    const wrong = await signIn("google", { address: "eve@x.test", mailboxId });
    expect(await finish("google", wrong.query)).toEqual(refused("oauth_wrong_account"));
    const same = await signIn("google", { address: "ann@X.test", mailboxId });
    const result = await finish("google", same.query);
    expect(result.ok && result.grant.start.mailboxId).toBe(mailboxId);
    // A mailbox removed after the start: nothing to reconnect.
    // (Its state row goes with it, so the removal has to happen while the code is redeemed.)
    const gone = await signIn("google", { address: "ann@x.test", mailboxId });
    const real = clients.google;
    const use = stubClient("google", async (code, verifier) => {
      await db.deleteFrom("mailboxes").where("id", "=", mailboxId).execute();
      return real === undefined ? Promise.reject(new Error("no client")) : real.redeemCode(code, verifier);
    });
    expect(await finish("google", gone.query, { use })).toEqual(refused("oauth_failed"));
  });

  test("10. no client for the provider: not_configured, the provider is not called, the state stays", async () => {
    const { query } = await signIn("google", { address: "a@x.test" });
    const before = fake.calls.length;
    expect(await finish("google", query, { use: { microsoft: clients.microsoft } as MailOAuthClients })).toEqual(
      refused("not_configured")
    );
    expect(await finish("google", query, { use: {} })).toEqual(refused("not_configured"));
    expect(fake.calls.length).toBe(before);
    expect(await stateRows()).toHaveLength(1);
  });
});

describe("the state binding at the callback", () => {
  test("11. a state of another provider: oauth_state_invalid, the row stays and nothing is redeemed", async () => {
    const { query } = await signIn("microsoft", { address: "a@x.test" });
    const before = fake.calls.length;
    expect(await finish("google", query)).toEqual(refused("oauth_state_invalid"));
    expect(await stateRows()).toHaveLength(1);
    expect(fake.calls.length).toBe(before);
    // The right provider still finishes it.
    expect((await finish("microsoft", query)).ok).toBe(true);
  });

  test("12. another user or another organization: oauth_state_invalid, the row stays", async () => {
    // V is a member of both organizations: only the organization filter can refuse the second case.
    const { id: both } = await insertUser(db, { email: `both-${randomUUID()}@x.test`, displayName: "Both" });
    await insertMembership(db, ctxA(), { userId: both, role: "owner" });
    await insertMembership(db, { orgId: org.otherOrgId }, { userId: both, role: "owner" });
    try {
      const { query } = await signIn("google", { address: "a@x.test", userId: both });
      expect(await finish("google", query, { userId: org.ownerId })).toEqual(refused("oauth_state_invalid"));
      expect(await finish("google", query, { userId: both, ctx: { orgId: org.otherOrgId } })).toEqual(
        refused("oauth_state_invalid")
      );
      expect(await stateRows()).toHaveLength(1);
      expect((await finish("google", query, { userId: both })).ok).toBe(true);
    } finally {
      await db.deleteFrom("users").where("id", "=", both).execute();
    }
  });

  test("13. a member removed after the start: oauth_state_invalid, nothing is redeemed, the row is gone", async () => {
    const { query } = await signIn("google", { address: "a@x.test", userId: org.assistantId });
    await db.deleteFrom("memberships").where("org_id", "=", org.orgId).where("user_id", "=", org.assistantId).execute();
    const before = fake.calls.length;
    expect(await finish("google", query, { userId: org.assistantId })).toEqual(refused("oauth_state_invalid"));
    expect(fake.calls.length).toBe(before);
    expect(await stateRows()).toHaveLength(0);
  });

  test("14. an expired state: oauth_state_expired, nothing is redeemed, the row is gone", async () => {
    const { query } = await signIn("google", { address: "a@x.test" });
    const before = fake.calls.length;
    const later = new Date(Date.now() + OAUTH_STATE_TTL_MS + MINUTE_MS);
    expect(await finish("google", query, { now: later })).toEqual(refused("oauth_state_expired"));
    expect(fake.calls.length).toBe(before);
    expect(await stateRows()).toHaveLength(0);
  });

  test("15. the state is consumed and committed on the pool before the code is redeemed", async () => {
    const { query } = await signIn("google", { address: "a@x.test" });
    let rowsAtRedeem = -1;
    const real = clients.google;
    const use = stubClient("google", async (code, verifier) => {
      // Another connection reads the table while the redeem runs.
      rowsAtRedeem = (await stateRows()).length;
      return real === undefined ? Promise.reject(new Error("no client")) : real.redeemCode(code, verifier);
    });
    expect((await finish("google", query, { use })).ok).toBe(true);
    expect(rowsAtRedeem).toBe(0);
  });

  test("16. the same state in two parallel callbacks: one grant, one oauth_state_invalid, one redeem", async () => {
    const { query } = await signIn("google", { address: "a@x.test" });
    const before = fake.calls.length;
    const results = await Promise.all(Array.from({ length: 6 }, () => finish("google", query)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "oauth_state_invalid")).toHaveLength(5);
    expect(fake.calls.length - before).toBe(1);
  });
});

describe("D18", () => {
  test("17. canary: code, state, verifier, tokens and the ID token are in no log line, no error and no refusal", async () => {
    const secretsSeen: string[] = [];
    // The real client with a tap: every value that goes to or comes from the token endpoint is a secret to look for.
    const tapped = (provider: MailOAuthProvider): MailOAuthClients => {
      const real = clients[provider];
      if (real === undefined) throw new Error("no client");
      return stubClient(provider, async (code, verifier) => {
        secretsSeen.push(code, verifier);
        const answer = await real.redeemCode(code, verifier);
        secretsSeen.push(
          answer.accessToken,
          answer.refreshToken ?? "",
          answer.idToken ?? "",
          answer.idToken?.split(".")[1] ?? ""
        );
        return answer;
      });
    };
    const attempts: { provider: MailOAuthProvider; over?: Record<string, unknown> }[] = [
      { provider: "google" },
      { provider: "microsoft" },
      { provider: "google", over: { emailVerified: false } },
      { provider: "google", over: { wrongVerifier: true } },
      { provider: "google", over: { scopes: ["openid"] } },
      { provider: "microsoft", over: { claims: { aud: "other" } } },
    ];
    const outputs: CallbackResult[] = [];
    for (const attempt of attempts) {
      const { query, state } = await signIn(attempt.provider, { address: "canary@x.test", ...(attempt.over ?? {}) });
      secretsSeen.push(query.code ?? "", state);
      outputs.push(await finish(attempt.provider, query, { use: tapped(attempt.provider) }));
      // A faulty token endpoint with a description that holds the code.
      const faulty = await signIn(attempt.provider, { address: "canary@x.test" });
      fake.failNext({
        status: 400,
        error: "invalid_grant",
        aadsts: 70008,
        description: `AADSTS70008: ${faulty.query.code}`,
      });
      secretsSeen.push(faulty.query.code ?? "", faulty.state);
      outputs.push(await finish(attempt.provider, faulty.query, { use: tapped(attempt.provider) }));
    }
    // An error in the query with a description that holds the state and the code.
    const error = await signIn("microsoft", { address: "canary@x.test" });
    secretsSeen.push(error.state, error.query.code ?? "");
    outputs.push(
      await finish("microsoft", {
        error: "access_denied",
        error_description: `AADSTS90094: ${error.state} ${error.query.code}`,
        state: error.state,
      })
    );
    secretsSeen.push(...fake.issuedRefreshTokens, fake.clientSecret);
    const grants = outputs.filter((output) => output.ok);
    const refusals = outputs.filter((output) => !output.ok);
    expect(grants).toHaveLength(2);
    expect(refusals.length).toBeGreaterThan(8);
    // A grant holds its tokens by design. A refusal and the log lines hold none.
    const seen = [...logLines, ...refusals.map((output) => inspect(output, { depth: 10 }))].join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    expect(secretsSeen.filter((value) => value !== "").length).toBeGreaterThan(30);
    for (const value of secretsSeen) {
      expect({ value: value.slice(0, 6), leaked: value !== "" && seen.includes(value) }).toEqual({
        value: value.slice(0, 6),
        leaked: false,
      });
    }
    for (const output of refusals) expect(Object.keys(output)).toEqual(["ok", "code"]);
    expect(logLines.join("\n")).not.toMatch(/eyJ|id_token/);
  });

  test("18. a refusal logs its code and provider and nothing else", async () => {
    const { state } = await signIn("google", { address: "a@x.test" });
    logLines.length = 0;
    await finish("google", { error: "access_denied", error_description: "user ann@x.test said no", state });
    const line = logLines.find((entry) => entry.includes("oauth_callback_refused")) ?? "";
    expect(line).toContain("oauth_cancelled");
    expect(logLines.join("\n")).not.toContain("ann@x.test");
  });
});
