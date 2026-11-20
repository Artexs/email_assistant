import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { sql } from "kysely";

import { applyOAuthGrant, createOAuthTokens, type MailOAuthClients } from "../../src/modules/mail";
import { withMailboxOAuthLock } from "../../src/modules/mail/oauth/secret-store";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { startFakeMailOAuth, type FakeMailOAuth } from "../fake-mail-oauth";

import { insertTestEmail } from "./fixtures";
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
  secrets,
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
  signIn,
  callback,
  auditOf,
  credentialsOf,
  secretOf,
  seedMailbox,
  mailboxOf,
  grantOf,
  depsOf,
} = makeOAuthConnectKit({
  db,
  org: () => org,
  fake: () => fake,
  clients: () => clients,
  secondOwnerId: () => secondOwnerId,
});

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
