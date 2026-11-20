import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";

import { applyOAuthGrant, type MailOAuthClients } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { testDb } from "./helpers";
import {
  dropped,
  GOOGLE_MAIL,
  HOSTS,
  locationOf,
  login,
  makeClients,
  makeOAuthConnectKit,
  resultOf,
} from "./mail-oauth-connect-helpers";
import { webOrg, type WebOrg } from "./web-helpers";

const db = testDb();

let fake: FakeMailOAuth;
let clients: MailOAuthClients;
let org: WebOrg;
let secondOwnerId = "";
let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

beforeAll(async () => {
  fake = await startFakeMailOAuth();
  clients = makeClients(fake);
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

const {
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
  grantOf,
  depsOf,
} = makeOAuthConnectKit({
  db,
  org: () => org,
  fake: () => fake,
  clients: () => clients,
  secondOwnerId: () => secondOwnerId,
});

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
