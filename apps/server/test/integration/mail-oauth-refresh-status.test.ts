import { format } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type {
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from "kysely";

import { MailAuthError, updateMailboxPassword, type MailOAuthClients } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { changeMailboxStatus, setMailboxStatus } from "../../src/modules/mail/repo";
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
  makeClients,
  tokensOf,
  ctxA,
  refreshCalls,
  linesOf,
  seedMailbox,
  mailboxOf,
  syncWith,
  script,
} = makeOAuthRefreshKit({ db, org: () => org, fake: () => fake, clients: () => clients, logLines: () => logLines });

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
