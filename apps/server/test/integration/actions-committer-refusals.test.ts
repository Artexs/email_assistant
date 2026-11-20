import { HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { createCommitterJob } from "../../src/modules/actions";
import { configureMailHosts, MailAuthError, resolveMailHost } from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";

import {
  NOW,
  secrets,
  Box,
  addBox,
  addMail,
  Opener,
  openerFor,
  jobFor,
  actionState,
  flagsOf,
  senderOpener,
  sendJob,
  pairOf,
} from "./actions-committer-helpers";
import { pauseOtherMailboxes, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The reason of an OAuth login refusal reaches `auth_reason` in the same write as the status.
describe("createCommitterJob: auth_error with a reason", () => {
  const oauthTokens = { accessToken: async () => "access-token-stub", drop: () => undefined };

  async function makeOauth(trx: Transaction<DB>, box: Box): Promise<void> {
    await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", box.mailboxId).execute();
    await trx
      .updateTable("mailbox_credentials")
      .set({ secret_kind: "oauth" })
      .where("mailbox_id", "=", box.mailboxId)
      .execute();
  }

  const jobWithTokens = (trx: Transaction<DB>, opener: Opener) =>
    createCommitterJob({
      db: trx,
      secrets,
      openProvider: opener.openProvider,
      oauthTokens,
      scope: { kind: "all" },
      now: () => NOW,
    });

  const mailboxState = (trx: Transaction<DB>, box: Box) =>
    trx
      .selectFrom("mailboxes")
      .select(["status", "auth_reason"])
      .where("id", "=", box.mailboxId)
      .executeTakeFirstOrThrow();

  test("a refused open with a reason sets auth_error and the reason together", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await makeOauth(trx, box);
      await addMail(trx, box, { messageId: "<f117a@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);
      opener.failures.set(box.address, new MailAuthError("bad login", { reason: "oauth_revoked" }));

      await jobWithTokens(trx, opener).run();

      expect(await mailboxState(trx, box)).toEqual({ status: "auth_error", auth_reason: "oauth_revoked" });
    });
  });

  test("an auth error in the middle of a batch carries its reason to the status", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await makeOauth(trx, box);
      await addMail(trx, box, { messageId: "<f117b@x.test>", actions: [{ type: "flag" }] });
      box.fake.failOn("setFlags", new MailAuthError("login", { reason: "protocol_disabled" }));

      await jobWithTokens(trx, openerFor([box])).run();

      expect(await mailboxState(trx, box)).toEqual({ status: "auth_error", auth_reason: "protocol_disabled" });
    });
  });

  test("a password mailbox keeps auth_reason NULL on the same paths", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<f117c@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);
      opener.failures.set(box.address, new MailAuthError("bad login"));

      await jobFor(trx, opener, { kind: "all" }).run();

      expect(await mailboxState(trx, box)).toEqual({ status: "auth_error", auth_reason: null });
    });
  });
});

describe("createCommitterJob with a suspended organization", () => {
  test("mailbox changes and sends of a suspended organization wait; the active one is served in the same run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      await suspendOrg(trx, b.orgId);
      const mailA = await addMail(trx, a, { messageId: "<a1@x.test>", actions: [{ type: "flag" }] });
      const mailB = await addMail(trx, b, { messageId: "<b1@x.test>", actions: [{ type: "flag" }] });
      const sendA = await pairOf(trx, a);
      const sendB = await pairOf(trx, b, {
        approved: { userId: b.userId as string, at: new Date(NOW.getTime() - HOUR_MS) },
      });
      const opener = openerFor([a, b]);
      const smtp = senderOpener();

      await sendJob(trx, opener, smtp, a).run();

      expect((await actionState(trx, mailA.actionIds[0] as string)).status).toBe("applied");
      expect(await flagsOf(a, mailA.uid)).toContain("\\Flagged");
      expect((await actionState(trx, sendA.sendId)).status).toBe("applied");
      expect(await actionState(trx, mailB.actionIds[0] as string)).toMatchObject({ status: "ready", locked_at: null });
      expect(await flagsOf(b, mailB.uid)).not.toContain("\\Flagged");
      expect(await actionState(trx, sendB.sendId)).toMatchObject({ status: "approved", locked_at: null });
      expect(opener.calls).toEqual([a.address]);
      expect(smtp.calls).toEqual([a.address]);
    });
  });
});

describe("createCommitterJob: a refused host blocks the mailbox", () => {
  // The preload (`bunfig.toml`) allows local hosts for GreenMail: put that policy back after each test.
  afterEach(() => {
    configureMailHosts({ allowLocal: true });
  });

  function refuse(...hosts: string[]): void {
    configureMailHosts({
      allowLocal: false,
      lookup: async (host) => [{ address: hosts.includes(host) ? "10.0.0.7" : "93.184.216.34", family: 4 }],
    });
  }

  async function mailboxOf(trx: Transaction<DB>, box: Box) {
    return trx
      .selectFrom("mailboxes")
      .select(["status", "status_changed_at"])
      .where("id", "=", box.mailboxId)
      .executeTakeFirstOrThrow();
  }

  async function blockAudit(trx: Transaction<DB>, box: Box) {
    return trx
      .selectFrom("audit_log")
      .select(["actor", "data"])
      .where("org_id", "=", box.orgId)
      .where("event", "=", "mailbox.host_blocked")
      .execute();
  }

  test("an SMTP host that the guard refuses blocks the mailbox and releases the send with no count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const guardedSmtp = smtp.openSender;
      smtp.openSender = async (opts) => {
        await resolveMailHost(opts.host);
        return guardedSmtp(opts);
      };
      const p = await pairOf(trx, box);
      refuse("smtp.x.test");

      await sendJob(trx, opener, smtp, box).run();

      expect(await mailboxOf(trx, box)).toEqual({ status: "host_blocked", status_changed_at: NOW });
      expect(await blockAudit(trx, box)).toEqual([
        { actor: "system", data: { mailbox_id: box.mailboxId, source: "committer" } },
      ]);
      expect(await actionState(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null, attempts: 0 });
      expect(smtp.sender.sent).toHaveLength(0);
    });
  });

  test("a failed DNS lookup of the SMTP host at send time keeps the mailbox active, with no block and no audit row", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const opener = openerFor([box]);
      const smtp = senderOpener();
      const guardedSmtp = smtp.openSender;
      smtp.openSender = async (opts) => {
        await resolveMailHost(opts.host);
        return guardedSmtp(opts);
      };
      await pairOf(trx, box);
      configureMailHosts({
        allowLocal: false,
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      });
      const warnings = spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await sendJob(trx, opener, smtp, box).run();
      } finally {
        warnings.mockRestore();
      }

      expect((await mailboxOf(trx, box)).status).toBe("active");
      expect(await blockAudit(trx, box)).toEqual([]);
      expect(smtp.sender.sent).toHaveLength(0);
    });
  });

  test("an IMAP host that the guard refuses blocks the mailbox and releases the move with no count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const mail = await addMail(trx, box, { messageId: "<h1@x.test>", actions: [{ type: "move" }] });
      const opener = openerFor([box]);
      const open = opener.openProvider;
      opener.openProvider = async (opts) => {
        await resolveMailHost(opts.host);
        return open(opts);
      };
      refuse("imap.x.test");

      await jobFor(trx, opener, { kind: "all" }).run();

      expect(await mailboxOf(trx, box)).toEqual({ status: "host_blocked", status_changed_at: NOW });
      expect(await blockAudit(trx, box)).toHaveLength(1);
      expect(await actionState(trx, mail.actionIds[0] as string)).toMatchObject({
        status: "ready",
        locked_at: null,
        attempts: 0,
      });
    });
  });

  test("another opener error does not block the mailbox", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      await addMail(trx, box, { messageId: "<h2@x.test>", actions: [{ type: "flag" }] });
      const opener = openerFor([box]);
      opener.failures.set(box.address, new Error("boom"));
      const errors = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await jobFor(trx, opener, { kind: "all" }).run();
      } finally {
        errors.mockRestore();
      }

      expect((await mailboxOf(trx, box)).status).toBe("active");
      expect(await blockAudit(trx, box)).toEqual([]);
    });
  });
});
