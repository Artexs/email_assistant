import { randomBytes, randomUUID } from "node:crypto";

import { encodeCallback } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createCommitterJob, noDelegationHooks } from "../../src/modules/actions";
import { handleCallback, type LinkedChat } from "../../src/modules/channels";
import { INBOX, syncMailbox } from "../../src/modules/mail";
import {
  createFakeMailProvider,
  type FakeMailProvider,
  type FakeMailProviderOptions,
} from "../../src/modules/mail/fake";
import { insertCredentials, updateCursor } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import { createReturnedJob } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTriagedWithActions, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const NOW = new Date("2026-11-07T12:00:00Z");
const RECEIVED = new Date(NOW.getTime() - 2 * HOUR);
const SINCE = new Date(RECEIVED.getTime() - 24 * HOUR);
const MESSAGE_ID = "<e2e-1@x.test>";
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

// Interia: a protocol COPY gives a new UID (no MOVE, UIDPLUS); a webmail move keeps it.
const INTERIA: FakeMailProviderOptions = {
  capabilities: { move: false, uidplus: true },
  keepUidOnCopy: false,
  keepUidOnUserMove: true,
  uidValidity: 7,
};

interface Setup {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  fake: FakeMailProvider;
  emailId: string;
  link: LinkedChat;
}

// A stored INBOX mail with ready flag, mark_read and move rows; the sync cursor sits at its UID.
async function setup(trx: Transaction<DB>): Promise<Setup> {
  await pauseOtherMailboxes(trx);
  const address = `box-${randomUUID()}@x.test`;
  const box = await createOrgWithMailbox(trx, { address });
  const ctx = { orgId: box.orgId };
  const secret = secrets.encrypt("pw", `mailbox:${box.mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId: box.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  const fake = createFakeMailProvider(INTERIA);
  const uid = fake.deliver(
    INBOX,
    { messageId: MESSAGE_ID, from: "sender@x.test", to: [address], subject: "s", date: RECEIVED },
    { internalDate: RECEIVED }
  );
  const meta = await fake.fetchMetaIn(INBOX, uid);
  const mail = await insertTriagedWithActions(trx, ctx, box.mailboxId, {
    category: "info",
    createdAt: RECEIVED,
    receivedAt: RECEIVED,
    from: "sender@x.test",
    messageId: MESSAGE_ID,
    uid,
    contentHash: contentHash(meta as NonNullable<typeof meta>),
    actions: [
      { type: "flag", status: "ready" },
      { type: "mark_read", status: "ready" },
      { type: "move", status: "ready", payload: { folder: "ai_info" } },
    ],
  });
  expect(
    await updateCursor(trx, ctx, box.mailboxId, { uidValidity: null, lastUid: null }, { uidValidity: 7, lastUid: uid })
  ).toBe(true);
  return {
    ctx,
    userId: box.userId,
    mailboxId: box.mailboxId,
    address,
    fake,
    emailId: mail.emailId,
    link: { orgId: box.orgId, userId: box.userId, role: "owner", chatId: 1, linkedAt: new Date(NOW.getTime() - HOUR) },
  };
}

function committerFor(trx: Transaction<DB>, s: Setup) {
  return createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => s.fake,
    scope: { kind: "all" },
    now: () => NOW,
  });
}

const syncDeps = (trx: Transaction<DB>, s: Setup) => ({
  db: trx,
  provider: s.fake,
  isOwnActionId: async () => false,
  now: () => NOW,
});

async function feedbackSources(trx: Transaction<DB>, s: Setup): Promise<string[]> {
  const rows = await trx
    .selectFrom("triage_feedback")
    .select("source")
    .where("email_id", "=", s.emailId)
    .orderBy("created_at")
    .execute();
  return rows.map((row) => row.source);
}

describe("actions end to end", () => {
  test("(a) committer, Undo tap, committer, sync, returned job: INBOX without the flag, no imap_move row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await committerFor(trx, s).run();
      expect(await s.fake.searchSinceIn(INBOX, SINCE)).toEqual([]);
      const [movedUid] = await s.fake.searchSinceIn("AI/Info", SINCE);
      expect((await s.fake.fetchMetaIn("AI/Info", movedUid as number))?.flags).toContain("\\Flagged");

      const tap = await handleCallback(
        {
          db: trx,
          now: () => NOW,
          actionsScope: { kind: "all" },
          hooks: noDelegationHooks,
          uidplus: async () => true,
          sendScope: { kind: "off" },
        },
        s.link,
        encodeCallback({ kind: "undo", emailId: s.emailId })
      );
      expect(tap.answer).toContain("Undo started");
      await committerFor(trx, s).run();

      const back = await s.fake.searchSinceIn(INBOX, SINCE);
      expect(back).toHaveLength(1);
      expect((await s.fake.fetchMetaIn(INBOX, back[0] as number))?.flags).not.toContain("\\Flagged");
      expect(await s.fake.searchSinceIn("AI/Info", SINCE)).toEqual([]);
      expect(await feedbackSources(trx, s)).toEqual(["undo"]);

      await syncMailbox(syncDeps(trx, s), s.ctx, s.mailboxId);
      await createReturnedJob({ db: trx, now: () => NOW }).run();

      expect(await feedbackSources(trx, s)).toEqual(["undo"]);
      const email = await trx.selectFrom("emails").selectAll().where("id", "=", s.emailId).executeTakeFirstOrThrow();
      expect(email).toMatchObject({ folder: INBOX, returned_at: null });
      const emails = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", s.mailboxId).execute();
      expect(emails).toHaveLength(1);
    });
  });

  test("(b) committer, user move back below the cursor, sync, returned job: one imap_move row, move undone", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await committerFor(trx, s).run();
      const [movedUid] = await s.fake.searchSinceIn("AI/Info", SINCE);
      s.fake.userMove("AI/Info", movedUid as number, INBOX);

      await syncMailbox(syncDeps(trx, s), s.ctx, s.mailboxId);
      await createReturnedJob({ db: trx, now: () => NOW }).run();

      expect(await feedbackSources(trx, s)).toEqual(["imap_move"]);
      const move = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("email_id", "=", s.emailId)
        .where("type", "=", "move")
        .executeTakeFirstOrThrow();
      expect(move).toEqual({ status: "undone", status_reason: "user_moved_back" });
      const email = await trx
        .selectFrom("emails")
        .select("returned_at")
        .where("id", "=", s.emailId)
        .executeTakeFirstOrThrow();
      expect(email.returned_at).toBeNull();
    });
  });
});
