import { randomBytes, randomUUID } from "node:crypto";
import { format } from "node:util";

import { afterAll, afterEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type { Transaction } from "kysely";

import type {
  GraphSenderOptions,
  ImapConnectOptions,
  OAuthTokens,
  SmtpConnectOptions,
  TokenResource,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { openMailboxProvider } from "../../src/modules/mail/open";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

afterAll(async () => {
  await db.destroy();
});

// Canary tokens: a test that finds one in a log line, an error text or `String(error)` fails.
const MAIL_TOKEN = "mail-tok-canary-71f3";
const GRAPH_TOKEN = "graph-tok-canary-9b2c";

let logLines: string[] = [];
let logSpies: Mock<(...args: unknown[]) => void>[] = [];

afterEach(() => {
  for (const spy of logSpies) spy.mockRestore();
  logSpies = [];
  setLogLevel("info");
});

// `format` shows a raw error object in the text: a token inside an error shows here too.
function captureLogs(): void {
  logLines = [];
  setLogLevel("debug");
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(format(...args));
    });
    logSpies.push(spy as unknown as Mock<(...args: unknown[]) => void>);
  }
}

function stubTokens(): OAuthTokens & { calls: { resource: TokenResource; fresh: boolean }[]; dropped: string[] } {
  const calls: { resource: TokenResource; fresh: boolean }[] = [];
  const dropped: string[] = [];
  return {
    calls,
    dropped,
    async accessToken(_ctx, _mailboxId, resource, opts) {
      calls.push({ resource, fresh: opts?.fresh === true });
      return resource === "mail" ? MAIL_TOKEN : GRAPH_TOKEN;
    },
    drop: (mailboxId) => void dropped.push(mailboxId),
  };
}

// A mailbox with an `oauth` credential. The stored secret stands for the refresh token: `open.ts` never reads it.
async function oauthMailbox(
  trx: Transaction<DB>,
  sendVia: "smtp" | "graph"
): Promise<{ ctx: TenantContext; mailboxId: string; address: string }> {
  const address = `box-${randomUUID()}@x.test`;
  const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
  const secret = secrets.encrypt("refresh-tok-canary-5d1e", `mailbox:${mailboxId}`);
  await trx
    .insertInto("mailbox_credentials")
    .values({
      mailbox_id: mailboxId,
      org_id: orgId,
      encrypted_secret: secret.ciphertext,
      secret_kind: "oauth",
      key_version: secret.keyVersion,
    })
    .execute();
  await trx
    .updateTable("mailboxes")
    .set({ send_via: sendVia, oauth_provider: sendVia === "graph" ? "microsoft" : "google" })
    .where("id", "=", mailboxId)
    .execute();
  return { ctx: { orgId }, mailboxId, address };
}

describe("openMailboxProvider", () => {
  test("decrypts the password and passes host, port, user and password to openProvider", async () => {
    await withRollback(db, async (trx) => {
      const address = `box-${randomUUID()}@x.test`;
      const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
      const ctx = { orgId };
      const secret = secrets.encrypt("s3cret-pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const seen: ImapConnectOptions[] = [];
      const fake = createFakeMailProvider();
      const deps = {
        db: trx,
        secrets,
        openProvider: async (opts: ImapConnectOptions) => {
          seen.push(opts);
          return fake;
        },
      };

      const { provider, mailbox } = await openMailboxProvider(deps, ctx, mailboxId);
      expect(provider).toBe(fake);
      expect(mailbox.id).toBe(mailboxId);
      expect(seen).toEqual([
        {
          host: mailbox.imap_host,
          port: mailbox.imap_port,
          user: address,
          auth: { kind: "password", password: "s3cret-pw" },
        },
      ]);
    });
  });

  test("withSender opens the SMTP sender with the same password and the smtp host and port", async () => {
    await withRollback(db, async (trx) => {
      const address = `box-${randomUUID()}@x.test`;
      const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
      const ctx = { orgId };
      const secret = secrets.encrypt("s3cret-pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const seen: SmtpConnectOptions[] = [];
      const fakeSender = createFakeMailSender();
      const fake = createFakeMailProvider();
      const deps = {
        db: trx,
        secrets,
        openProvider: async () => fake,
        openSender: async (opts: SmtpConnectOptions) => {
          seen.push(opts);
          return fakeSender;
        },
      };

      const without = await openMailboxProvider(deps, ctx, mailboxId);
      expect(without.sender).toBeNull();
      expect(seen).toEqual([]);

      const { sender, mailbox } = await openMailboxProvider(deps, ctx, mailboxId, { withSender: true });
      expect(sender).toBe(fakeSender);
      expect(seen).toEqual([
        {
          host: mailbox.smtp_host,
          port: mailbox.smtp_port,
          security: "tls",
          user: address,
          auth: { kind: "password", password: "s3cret-pw" },
        },
      ]);

      // The stored mode reaches the sender: a STARTTLS mailbox opens its sender with `starttls`.
      await trx.updateTable("mailboxes").set({ smtp_security: "starttls" }).where("id", "=", mailboxId).execute();
      seen.length = 0;
      await openMailboxProvider(deps, ctx, mailboxId, { withSender: true });
      expect(seen.map((opts) => opts.security)).toEqual(["starttls"]);

      const noOpener = { db: trx, secrets, openProvider: async () => fake };
      const bare = await openMailboxProvider(noOpener, ctx, mailboxId, { withSender: true });
      expect(bare.sender).toBeNull();

      const failing = {
        ...deps,
        openSender: async () => {
          throw new HardError("smtp");
        },
      };
      fake.closed = false;
      await expect(openMailboxProvider(failing, ctx, mailboxId, { withSender: true })).rejects.toBeInstanceOf(
        HardError
      );
      expect(fake.closed).toBe(true);
    });
  });

  test("throws HardError for a missing mailbox, another org's mailbox and a missing password", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const deps = { db: trx, secrets, openProvider: async () => createFakeMailProvider() };

      await expect(openMailboxProvider(deps, { orgId: a.orgId }, randomUUID())).rejects.toBeInstanceOf(HardError);
      await expect(openMailboxProvider(deps, { orgId: b.orgId }, a.mailboxId)).rejects.toBeInstanceOf(HardError);
      await expect(openMailboxProvider(deps, { orgId: a.orgId }, a.mailboxId)).rejects.toBeInstanceOf(HardError);
    });
  });
  test("an oauth mailbox with send_via graph: IMAP gets the mail token, the Graph sender gets the graph token and the address", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, address } = await oauthMailbox(trx, "graph");
      const tokens = stubTokens();
      const seenImap: ImapConnectOptions[] = [];
      const seenGraph: GraphSenderOptions[] = [];
      const smtpCalls: SmtpConnectOptions[] = [];
      const graphSender = createFakeMailSender();
      const fake = createFakeMailProvider();
      const deps = {
        db: trx,
        secrets,
        oauthTokens: tokens,
        openProvider: async (opts: ImapConnectOptions) => {
          seenImap.push(opts);
          return fake;
        },
        openSender: async (opts: SmtpConnectOptions) => {
          smtpCalls.push(opts);
          return createFakeMailSender();
        },
        openGraphSender: async (opts: GraphSenderOptions) => {
          seenGraph.push(opts);
          return graphSender;
        },
      };
      captureLogs();

      const { sender, mailbox } = await openMailboxProvider(deps, ctx, mailboxId, { withSender: true });

      expect(sender).toBe(graphSender);
      expect(mailbox.send_via).toBe("graph");
      expect(mailbox.oauth_provider).toBe("microsoft");
      expect(seenImap.map((opts) => opts.auth)).toEqual([{ kind: "oauth", accessToken: MAIL_TOKEN }]);
      expect(seenImap[0]?.user).toBe(address);
      expect(seenGraph).toHaveLength(1);
      expect(seenGraph[0]).toMatchObject({ accessToken: GRAPH_TOKEN, from: address });
      expect(smtpCalls).toEqual([]);
      expect(tokens.calls).toEqual([
        { resource: "mail", fresh: false },
        { resource: "graph", fresh: false },
      ]);

      // `freshToken` asks the store for a new graph token that skips the cache.
      expect(await seenGraph[0]?.freshToken()).toBe(GRAPH_TOKEN);
      expect(tokens.calls.at(-1)).toEqual({ resource: "graph", fresh: true });
      expect(logLines.join("\n")).not.toContain("canary");
    });
  });

  test("an oauth mailbox with send_via smtp (Google): the SMTP sender gets the mail token", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId, address } = await oauthMailbox(trx, "smtp");
      const tokens = stubTokens();
      const seen: SmtpConnectOptions[] = [];
      const deps = {
        db: trx,
        secrets,
        oauthTokens: tokens,
        openProvider: async () => createFakeMailProvider(),
        openSender: async (opts: SmtpConnectOptions) => {
          seen.push(opts);
          return createFakeMailSender();
        },
      };

      await openMailboxProvider(deps, ctx, mailboxId, { withSender: true });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ user: address, auth: { kind: "oauth", accessToken: MAIL_TOKEN } });
      expect(tokens.calls.map((call) => call.resource)).toEqual(["mail"]);
    });
  });

  test("send_via graph and no openGraphSender: sender is null, one warn line with the mailbox id, the provider stays open", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await oauthMailbox(trx, "graph");
      const fake = createFakeMailProvider();
      const deps = {
        db: trx,
        secrets,
        oauthTokens: stubTokens(),
        openProvider: async () => fake,
        openSender: async () => createFakeMailSender(),
      };
      captureLogs();

      const { sender, provider } = await openMailboxProvider(deps, ctx, mailboxId, { withSender: true });

      expect(sender).toBeNull();
      expect(provider).toBe(fake);
      expect(fake.closed).toBe(false);
      const warns = logLines.filter((line) => line.includes("mailbox_sender_missing"));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain(mailboxId);
      expect(logLines.join("\n")).not.toContain("canary");

      // A call that wants no sender does not warn.
      logLines.length = 0;
      await openMailboxProvider(deps, ctx, mailboxId);
      expect(logLines.filter((line) => line.includes("mailbox_sender_missing"))).toEqual([]);
    });
  });

  test("an oauth credential and no oauthTokens: HardError and no connection", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await oauthMailbox(trx, "smtp");
      const seen: ImapConnectOptions[] = [];
      const deps = {
        db: trx,
        secrets,
        openProvider: async (opts: ImapConnectOptions) => {
          seen.push(opts);
          return createFakeMailProvider();
        },
        openSender: async () => createFakeMailSender(),
      };
      captureLogs();

      const error = await openMailboxProvider(deps, ctx, mailboxId, { withSender: true }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HardError);
      expect((error as HardError).message).toBe("oauth not wired");
      expect(seen).toEqual([]);
      // `String(error)` and the log text hold no token and no refresh token.
      expect(`${String(error)}\n${format(error)}\n${logLines.join("\n")}`).not.toContain("canary");
    });
  });

  test("the Graph token fails: the provider is closed and the error passes on", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, mailboxId } = await oauthMailbox(trx, "graph");
      const fake = createFakeMailProvider();
      const failing: OAuthTokens = {
        accessToken: async (_ctx, _id, resource) => {
          if (resource === "graph") throw new HardError("graph token refused");
          return MAIL_TOKEN;
        },
        drop: () => undefined,
      };
      const deps = {
        db: trx,
        secrets,
        oauthTokens: failing,
        openProvider: async () => fake,
        openGraphSender: async () => createFakeMailSender(),
      };

      await expect(openMailboxProvider(deps, ctx, mailboxId, { withSender: true })).rejects.toThrow(
        "graph token refused"
      );
      expect(fake.closed).toBe(true);
    });
  });

  test("send_via graph on a password mailbox: HardError before any connection", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const secret = secrets.encrypt("s3cret-pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      // The table CHECK allows this row (`oauth_provider` is microsoft); only the credential kind is wrong.
      await trx
        .updateTable("mailboxes")
        .set({ send_via: "graph", oauth_provider: "microsoft" })
        .where("id", "=", mailboxId)
        .execute();
      const seen: ImapConnectOptions[] = [];
      const deps = {
        db: trx,
        secrets,
        oauthTokens: stubTokens(),
        openGraphSender: async () => createFakeMailSender(),
        openProvider: async (opts: ImapConnectOptions) => {
          seen.push(opts);
          return createFakeMailProvider();
        },
      };

      await expect(openMailboxProvider(deps, ctx, mailboxId, { withSender: true })).rejects.toBeInstanceOf(HardError);
      expect(seen).toEqual([]);
    });
  });
});
