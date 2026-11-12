import { randomBytes, randomUUID } from "node:crypto";

import { connectResultSchema, mailboxListSchema, mailboxViewSchema, type ScopeEnv } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Hono } from "hono";

import { queueMailboxRemovedNotices } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import {
  MailAuthError,
  mailRoutes,
  WEB_MAIL_TIMEOUTS,
  type ImapConnectOptions,
  type MailProvider,
  type SmtpConnectOptions,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertInboxFolder, insertMailbox, setMailboxStatus } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import { HardError, SoftError } from "../../src/platform/errors";
import type { ApiEnv } from "../../src/platform/http";
import { setLogLevel } from "../../src/platform/log";

import { linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-11T10:00:00.000Z");

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string, address: string, createdAt: Date): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await db.updateTable("mailboxes").set({ created_at: createdAt }).where("id", "=", id).execute();
  await insertInboxFolder(db, ctx, id);
  await insertDefaultSettings(db, ctx, id);
  await db
    .insertInto("mailbox_credentials")
    .values({ mailbox_id: id, org_id: orgId, encrypted_secret: "x", secret_kind: "password", key_version: 1 })
    .execute();
  return id;
}

interface SetupOptions {
  allowLocalHosts?: boolean;
  openProvider?: (opts: ImapConnectOptions) => Promise<MailProvider>;
  verifySmtp?: (opts: SmtpConnectOptions) => Promise<void>;
}

async function setup(options: SetupOptions = {}) {
  const imapCalls: ImapConnectOptions[] = [];
  const smtpCalls: SmtpConnectOptions[] = [];
  const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
  const org = await webOrg(db);
  orgs.push(org);
  const suffix = randomUUID();
  const address1 = `box-one-${suffix}@x.test`;
  const address2 = `box-two-${suffix}@x.test`;
  const m1 = await addMailbox(org.orgId, address1, new Date("2026-11-01T10:00:00Z"));
  const m2 = await addMailbox(org.orgId, address2, new Date("2026-11-02T10:00:00Z"));
  const other = await addMailbox(org.otherOrgId, `box-other-${suffix}@x.test`, new Date("2026-11-03T10:00:00Z"));
  const scopeEnv: ScopeEnv = {
    triage: "all",
    actions: "synthetic",
    send: "off",
  };
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, assistant: org.assistantId },
    routers: (api: Hono<ApiEnv>) =>
      api.route(
        "/",
        mailRoutes({
          db,
          now: () => NOW,
          scopeEnv,
          connect: {
            db,
            secrets,
            openProvider: async (opts) => {
              imapCalls.push(opts);
              return options.openProvider ? options.openProvider(opts) : createFakeMailProvider();
            },
            verifySmtp: async (opts) => {
              smtpCalls.push(opts);
              if (options.verifySmtp) await options.verifySmtp(opts);
            },
            timeouts: WEB_MAIL_TIMEOUTS,
          },
          allowLocalHosts: options.allowLocalHosts ?? false,
          onRemoved: async (trx, ctx, input) => {
            await queueMailboxRemovedNotices(trx, ctx, input);
          },
        })
      ),
  });
  return { org, app, m1, m2, other, address1, address2, imapCalls, smtpCalls, secrets };
}

const auditOf = (orgId: string, event: string) =>
  db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).execute();

describe("mailbox routes", () => {
  test("the access matrix", async () => {
    const { app, m1, other } = await setup();
    const routes: [string, string][] = [
      ["POST", `/api/mailboxes/${m1}/pause`],
      ["POST", `/api/mailboxes/${m1}/resume`],
      ["DELETE", `/api/mailboxes/${m1}`],
    ];
    const noCookie = (method: string) => ({ method, headers: { origin: TEST_ORIGIN } });
    expect((await app.request("/api/mailboxes", noCookie("GET"))).status).toBe(401);
    for (const [method, path] of routes) {
      expect((await app.request(path, noCookie(method))).status).toBe(401);
      const asAssistant = await app.request(path, as("assistant", { method, body: { confirmAddress: "x" } }));
      expect(asAssistant.status).toBe(403);
      expect(await asAssistant.json()).toEqual({ error: "owner_only" });
    }
    expect((await app.request("/api/mailboxes", as("assistant"))).status).toBe(200);

    const body = { confirmAddress: "x@x.test" };
    for (const [method, suffix] of [
      ["POST", "pause"],
      ["POST", "resume"],
      ["DELETE", ""],
    ] as const) {
      for (const id of [other, "not-a-uuid"]) {
        const path = suffix ? `/api/mailboxes/${id}/${suffix}` : `/api/mailboxes/${id}`;
        const res = await app.request(path, as("owner", { method, body }));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    }

    const empty = await app.request(`/api/mailboxes/${m1}`, as("owner", { method: "DELETE", body: {} }));
    expect(empty.status).toBe(400);
    const json = (await empty.json()) as { error: string; details: { path: string }[] };
    expect(json.error).toBe("validation");
    expect(json.details[0]?.path).toBe("confirmAddress");

    const noOrigin = await app.request(`/api/mailboxes/${m1}`, {
      method: "DELETE",
      headers: { cookie: "ea.session_token=owner", "content-type": "application/json" },
      body: JSON.stringify({ confirmAddress: "x" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await noOrigin.json()).toEqual({ error: "bad_origin" });
  });

  test("GET lists the views in creation order with the scope badges", async () => {
    const { app, m1, m2, address1, address2 } = await setup();
    const res = await app.request("/api/mailboxes", as("owner"));
    expect(res.status).toBe(200);
    const views = mailboxListSchema.parse(await res.json());
    expect(views.map((v) => v.id)).toEqual([m1, m2]);
    expect(views.map((v) => v.address)).toEqual([address1, address2]);
    const [first, second] = views;
    expect(first?.scopes.triage).toEqual({ state: "on", reason: "all_mailboxes" });
    expect(first?.scopes.actions).toEqual({ state: "synthetic", reason: "synthetic_only" });
    expect(first?.scopes.send).toEqual({ state: "off", reason: "env_off" });
    expect(second?.scopes.triage).toEqual({ state: "on", reason: "all_mailboxes" });
    expect(first?.mode).toBe("shadow");
    expect(first?.lastSyncedAt).toBeNull();
    expect(first?.secretKind).toBe("password");
  });

  test("pause and resume write one audit row each and are idempotent", async () => {
    const { org, app, m1 } = await setup();
    const pause = () => app.request(`/api/mailboxes/${m1}/pause`, as("owner", { method: "POST" }));
    const first = await pause();
    expect(first.status).toBe(200);
    expect(mailboxViewSchema.parse(await first.json()).status).toBe("paused");
    const [row] = await auditOf(org.orgId, "mailbox.paused");
    expect(row?.data).toEqual({ mailbox_id: m1, via: "web" });
    expect(row?.actor).toBe(org.ownerId);

    expect((await pause()).status).toBe(200);
    expect(await auditOf(org.orgId, "mailbox.paused")).toHaveLength(1);

    const resume = await app.request(`/api/mailboxes/${m1}/resume`, as("owner", { method: "POST" }));
    expect(resume.status).toBe(200);
    expect(mailboxViewSchema.parse(await resume.json()).status).toBe("active");
    expect(await auditOf(org.orgId, "mailbox.resumed")).toHaveLength(1);
  });

  test("pause of a mailbox in auth_error gives 409", async () => {
    const { org, app, m2 } = await setup();
    await setMailboxStatus(db, { orgId: org.orgId }, m2, "auth_error");
    const res = await app.request(`/api/mailboxes/${m2}/pause`, as("owner", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wrong_status" });
  });

  test("delete takes the typed address, notifies the linked owner and then gives 404", async () => {
    const { org, app, m1, m2, address1 } = await setup();
    await db.transaction().execute((trx) => linkChat(trx, { orgId: org.orgId }, org.ownerId, randomChatId(), NOW));
    const remove = () =>
      app.request(
        `/api/mailboxes/${m1}`,
        as("owner", { method: "DELETE", body: { confirmAddress: ` ${address1.toUpperCase()} ` } })
      );
    const res = await remove();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const list = mailboxListSchema.parse(await (await app.request("/api/mailboxes", as("owner"))).json());
    expect(list.map((v) => v.id)).toEqual([m2]);
    const outbox = await db
      .selectFrom("outbox")
      .select("id")
      .where("org_id", "=", org.orgId)
      .where("kind", "=", "mailbox_removed")
      .execute();
    expect(outbox).toHaveLength(1);

    expect((await remove()).status).toBe(404);
  });

  test("delete with the wrong address changes nothing", async () => {
    const { app, m1 } = await setup();
    const res = await app.request(
      `/api/mailboxes/${m1}`,
      as("owner", { method: "DELETE", body: { confirmAddress: "wrong@x.test" } })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "confirm_mismatch" });
    const views = mailboxListSchema.parse(await (await app.request("/api/mailboxes", as("owner"))).json());
    expect(views.find((v) => v.id === m1)?.status).toBe("active");
  });

  test("connect and password routes: 401, 403, 404 and 400 without the password", async () => {
    const { app, other } = await setup();
    const connectBody = {
      address: "anna@gmail.com",
      password: "s3cret pass",
      secretKind: "app_password",
      preset: "gmail",
    };
    const passwordBody = { password: "s3cret pass", secretKind: "password" };
    const noCookie = { origin: TEST_ORIGIN, "content-type": "application/json" };
    for (const [path, body] of [
      ["/api/mailboxes", connectBody],
      [`/api/mailboxes/${other}/password`, passwordBody],
    ] as const) {
      const anon = await app.request(path, { method: "POST", headers: noCookie, body: JSON.stringify(body) });
      expect(anon.status).toBe(401);
      const assistant = await app.request(path, as("assistant", { method: "POST", body }));
      expect(assistant.status).toBe(403);
    }
    const foreign = await app.request(
      `/api/mailboxes/${other}/password`,
      as("owner", { method: "POST", body: passwordBody })
    );
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "not_found" });
    const badId = await app.request(
      "/api/mailboxes/not-a-uuid/password",
      as("owner", { method: "POST", body: passwordBody })
    );
    expect(badId.status).toBe(404);

    for (const [path, body] of [
      ["/api/mailboxes", { ...connectBody, preset: undefined }],
      ["/api/mailboxes", { ...connectBody, imapHost: "imap.x.test" }],
      [`/api/mailboxes/${other}/password`, { password: "s3cret pass", secretKind: "nope" }],
    ] as const) {
      const res = await app.request(path, as("owner", { method: "POST", body }));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text).error).toBe("validation");
      expect(text).not.toContain("s3cret pass");
    }
  });

  test("connect by preset: 201, the login options, the list and the audit row", async () => {
    const { org, app, imapCalls, smtpCalls } = await setup();
    const res = await app.request(
      "/api/mailboxes",
      as("owner", {
        method: "POST",
        body: { address: "anna@gmail.com", password: "s3cret pass", secretKind: "app_password", preset: "gmail" },
      })
    );
    expect(res.status).toBe(201);
    const result = connectResultSchema.parse(await res.json());
    expect(result.address).toBe("anna@gmail.com");
    expect(result.status).toBe("active");
    expect(imapCalls).toHaveLength(1);
    expect(imapCalls[0]).toMatchObject({ host: "imap.gmail.com", port: 993, connectionTimeoutMs: 20_000 });
    expect(smtpCalls[0]).toMatchObject({ host: "smtp.gmail.com", port: 465, timeoutMs: 20_000 });

    const list = mailboxListSchema.parse(await (await app.request("/api/mailboxes", as("owner"))).json());
    expect(list.map((v) => v.id)).toContain(result.id);
    const rows = await auditOf(org.orgId, "mailbox.connected");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    expect(rows[0]?.data).toEqual({ mailbox_id: result.id, via: "web" });
  });

  test("connect with local hosts: refused before any login unless allowed", async () => {
    const other = {
      address: "local@x.test",
      password: "s3cret pass",
      secretKind: "password",
      imapHost: "127.0.0.1",
      imapPort: 3143,
      smtpHost: "127.0.0.1",
      smtpPort: 3025,
    };
    const closed = await setup({ allowLocalHosts: false });
    const refused = await closed.app.request("/api/mailboxes", as("owner", { method: "POST", body: other }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "host_not_allowed" });
    expect(closed.imapCalls).toHaveLength(0);
    expect(closed.smtpCalls).toHaveLength(0);

    const open = await setup({ allowLocalHosts: true });
    const accepted = await open.app.request("/api/mailboxes", as("owner", { method: "POST", body: other }));
    expect(accepted.status).toBe(201);
  });

  test("connect failures: 422 and 502 with a bare error body and no mailbox row", async () => {
    const body = { address: "fail@x.test", password: "s3cret pass", secretKind: "password", preset: "interia" };
    const cases: [SetupOptions, number, string][] = [
      [
        {
          openProvider: async () => {
            throw new MailAuthError("IMAP login failed");
          },
        },
        422,
        "mail_login_failed",
      ],
      [
        {
          openProvider: async () => {
            throw new SoftError("IMAP connect: connection error ETIMEDOUT");
          },
        },
        502,
        "mail_unreachable",
      ],
      [
        {
          verifySmtp: async () => {
            throw new HardError("SMTP verify failed (CERT_HAS_EXPIRED)");
          },
        },
        502,
        "mail_unreachable",
      ],
    ];
    for (const [options, status, code] of cases) {
      const { org, app } = await setup(options);
      const res = await app.request("/api/mailboxes", as("owner", { method: "POST", body }));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: code });
      const rows = await db
        .selectFrom("mailboxes")
        .select("id")
        .where("org_id", "=", org.orgId)
        .where("address", "=", body.address)
        .execute();
      expect(rows).toHaveLength(0);
    }
  });

  test("connect of a known address in another case gives 409 and no login", async () => {
    const { app, address1, imapCalls } = await setup();
    const res = await app.request(
      "/api/mailboxes",
      as("owner", {
        method: "POST",
        body: { address: address1.toUpperCase(), password: "s3cret pass", secretKind: "password", preset: "interia" },
      })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "mailbox_exists" });
    expect(imapCalls).toHaveLength(0);
  });

  test("password: auth_error becomes active; a failed login keeps the stored secret", async () => {
    const { org, app, m2, secrets } = await setup();
    await setMailboxStatus(db, { orgId: org.orgId }, m2, "auth_error");
    const credentials = () =>
      db.selectFrom("mailbox_credentials").selectAll().where("mailbox_id", "=", m2).executeTakeFirstOrThrow();
    const before = await credentials();

    const failing = await setup({
      openProvider: async () => {
        throw new MailAuthError("IMAP login failed");
      },
    });
    const failed = await failing.app.request(
      `/api/mailboxes/${failing.m2}/password`,
      as("owner", { method: "POST", body: { password: "new secret", secretKind: "password" } })
    );
    expect(failed.status).toBe(422);
    expect(await failed.json()).toEqual({ error: "mail_login_failed" });
    const unchanged = await db
      .selectFrom("mailbox_credentials")
      .selectAll()
      .where("mailbox_id", "=", failing.m2)
      .executeTakeFirstOrThrow();
    expect(unchanged.encrypted_secret).toBe("x");

    const res = await app.request(
      `/api/mailboxes/${m2}/password`,
      as("owner", { method: "POST", body: { password: "new secret", secretKind: "app_password" } })
    );
    expect(res.status).toBe(200);
    expect(mailboxViewSchema.parse(await res.json()).status).toBe("active");
    const after = await credentials();
    expect(after.encrypted_secret).not.toBe(before.encrypted_secret);
    expect(after.secret_kind).toBe("app_password");
    expect(
      secrets.decrypt({ ciphertext: after.encrypted_secret, keyVersion: after.key_version }, `mailbox:${m2}`)
    ).toBe("new secret");
    const [row] = await auditOf(org.orgId, "mailbox.password_changed");
    expect(row?.actor).toBe(org.ownerId);
    expect(row?.data).toEqual({ mailbox_id: m2, reactivated: true });
  });

  test("no log line holds the password, the address or a host", async () => {
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    setLogLevel("debug");
    let lines: string[] = [];
    const password = "s3cret pass";
    const address = "logcheck@gmail.com";
    try {
      const ok = await setup();
      await ok.app.request(
        "/api/mailboxes",
        as("owner", { method: "POST", body: { address, password, secretKind: "app_password", preset: "gmail" } })
      );
      const failing = await setup({
        openProvider: async () => {
          throw new MailAuthError(`IMAP login failed for ${address} at imap.gmail.com`);
        },
      });
      await failing.app.request(
        "/api/mailboxes",
        as("owner", { method: "POST", body: { address, password, secretKind: "app_password", preset: "gmail" } })
      );
      await setMailboxStatus(db, { orgId: failing.org.orgId }, failing.m2, "auth_error");
      await failing.app.request(
        `/api/mailboxes/${failing.m2}/password`,
        as("owner", { method: "POST", body: { password, secretKind: "password" } })
      );
      const timeout = await setup({
        openProvider: async () => {
          throw new SoftError(`IMAP connect: ETIMEDOUT imap.gmail.com ${address}`);
        },
      });
      await timeout.app.request(
        "/api/mailboxes",
        as("owner", { method: "POST", body: { address, password, secretKind: "app_password", preset: "gmail" } })
      );
      await ok.app.request(
        `/api/mailboxes/${ok.m2}/password`,
        as("owner", { method: "POST", body: { password, secretKind: "password" } })
      );
      lines = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(" "));
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      setLogLevel("info");
    }
    expect(lines.some((line) => line.includes("web: mailbox connect failed: MailAuthError"))).toBe(true);
    expect(lines.some((line) => line.includes("web: mailbox password check failed: MailAuthError"))).toBe(true);
    for (const line of lines) {
      for (const value of [password, address, "imap.gmail.com", "smtp.gmail.com"]) {
        expect(line).not.toContain(value);
      }
    }
  });
});
