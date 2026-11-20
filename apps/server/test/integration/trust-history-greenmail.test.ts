import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, expect, test } from "bun:test";

import {
  backfillMailbox,
  connectMailbox,
  openImapProvider,
  refreshFlagsOfMailbox,
  renderSeedMessage,
  syncMailbox,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";

import { testDb, withRollback } from "./helpers";

// The history path against the real IMAP server (GreenMail, bun run dev:up; auth is off, any password logs in): the 30-day search, the
// content fetch and the flags read of `backfillMailbox` (purpose history) and `refreshFlagsOfMailbox`. Random addresses.
const db = testDb();
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);

afterAll(async () => {
  await db.destroy();
});

test("history backfill stores the old mail below the cursor; the flag refresh reads \\Answered and \\Flagged from the server", async () => {
  await withRollback(db, async (trx) => {
    const suffix = randomUUID();
    const { orgId } = await createOrganizationWithOwner(trx, {
      orgName: `History Org ${suffix}`,
      timezone: "Europe/Warsaw",
      email: `history-${suffix}@x.test`,
      displayName: "Owner",
    });
    const ctx = { orgId };
    const address = `h-${suffix}@localhost`;
    const imap: ImapConnectOptions = {
      host,
      port: imapPort,
      user: address,
      auth: { kind: "password", password: `pw-${suffix}` },
    };
    const { mailboxId } = await connectMailbox(
      { db: trx, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
      ctx,
      { address, password: `pw-${suffix}`, secretKind: "password", imapHost: host, imapPort, smtpHost: host, smtpPort }
    );
    const now = new Date();
    const server = await openImapProvider(imap);
    try {
      const raw = (n: number) =>
        Buffer.from(
          renderSeedMessage({
            messageId: `<hist${n}-${suffix}@x.test>`,
            from: `sender${n}@x.test`,
            to: [address],
            subject: `History mail ${n}`,
            date: now,
            text: `Body ${n}`,
          })
        );
      // Three old mails first (below the cursor after the first sync), then one of the last hour, which the first sync stores.
      await server.appendMessage("INBOX", raw(1), ["\\Answered"], new Date(now.getTime() - 5 * DAY_MS));
      await server.appendMessage("INBOX", raw(2), ["\\Flagged"], new Date(now.getTime() - 10 * DAY_MS));
      await server.appendMessage("INBOX", raw(3), [], new Date(now.getTime() - 20 * DAY_MS));
      await server.appendMessage("INBOX", raw(4), [], new Date(now.getTime() - HOUR_MS));
      const synced = await syncMailbox(
        { db: trx, provider: server, isOwnActionId: async () => false, now: () => now },
        ctx,
        mailboxId
      );
      expect(synced.mode).toBe("initial");
      expect(synced.stored).toBe(1);
    } finally {
      await server.close();
    }

    const deps = { db: trx, secrets, isOwnActionId: async () => false };
    const outcome = await backfillMailbox(deps, ctx, mailboxId, { days: 30, now, purpose: "history" });
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.result.fetched).toBe(4);
    expect(outcome.result.stored).toBe(3);
    const rows = await trx
      .selectFrom("emails")
      .select(["uid", "status", "skip_reason"])
      .where("mailbox_id", "=", mailboxId)
      .orderBy("uid")
      .execute();
    expect(rows.map((row) => [Number(row.uid), row.status, row.skip_reason])).toEqual([
      [1, "skipped", "history_check"],
      [2, "skipped", "history_check"],
      [3, "skipped", "history_check"],
      [4, "pending", null],
    ]);

    const refreshed = await refreshFlagsOfMailbox(deps, ctx, mailboxId, () => now);
    expect(refreshed.checked).toBe(4);
    expect(refreshed.written).toBe(4);
    const flags = await trx
      .selectFrom("email_flags")
      .innerJoin("emails", "emails.id", "email_flags.email_id")
      .select(["emails.uid", "email_flags.answered", "email_flags.flagged"])
      .where("emails.mailbox_id", "=", mailboxId)
      .orderBy("emails.uid")
      .execute();
    expect(flags.map((row) => [Number(row.uid), row.answered, row.flagged])).toEqual([
      [1, true, false],
      [2, false, true],
      [3, false, false],
      [4, false, false],
    ]);
  });
});
