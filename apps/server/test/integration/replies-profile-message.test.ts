import { randomBytes, randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  createCommitterJob,
  editApproval,
  getSend,
  noApprovalHooks,
  type ApprovalDeps,
} from "../../src/modules/actions";
import { approvalViewFor } from "../../src/modules/channels/notices/approval";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender, type FakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertMailboxProfile } from "./reply-fixtures";

// The name and the signature of a mailbox reach every message of every kind. The committer, the
// approval view and the panel edit read the profile row of the mailbox; the fallbacks are the signature and the owner name. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const CREATED = new Date(NOW.getTime() - HOUR_MS);
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const OTHER_SIGNATURE = "Pozdrawiam, Jan";

interface World {
  ctx: TenantContext;
  userId: string;
  mailboxId: string;
  address: string;
  sender: FakeMailSender;
  sendId: string;
  draftId: string;
}

// A delegation draft (applied) with its approved send.
async function world(trx: Transaction<DB>): Promise<World> {
  await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  const mailbox = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  await trx
    .updateTable("mailboxes")
    .set({ folder_map: JSON.stringify({ drafts: "Drafts", sent: "Sent" }) })
    .where("id", "=", box.mailboxId)
    .execute();
  const secret = secrets.encrypt("pw", `mailbox:${box.mailboxId}`);
  await insertCredentials(trx, ctx, {
    mailboxId: box.mailboxId,
    encryptedSecret: secret.ciphertext,
    secretKind: "password",
    keyVersion: secret.keyVersion,
  });
  const p = await insertDraftAndSend(trx, ctx, box.mailboxId, {
    createdAt: CREATED,
    draftStatus: "applied",
    draftProviderResult: { uid: 1, folder: "Drafts" },
    sendStatus: "approved",
    approved: { userId: box.userId, at: new Date(NOW.getTime() - MINUTE_MS) },
    to: "anna@example.com",
    language: "pl",
    from: "boss@x.test",
    subject: "Offer",
    bodyText: "Please prepare the offer",
  });
  return {
    ctx,
    userId: box.userId,
    mailboxId: box.mailboxId,
    address: mailbox.address,
    sender: createFakeMailSender(),
    sendId: p.sendId,
    draftId: p.draftId,
  };
}

// The mail that the committer sends for the world: its raw text, decoded.
async function sentRaw(trx: Transaction<DB>, w: World): Promise<string> {
  const fake = createFakeMailProvider();
  await fake.ensureFolder("Drafts");
  await fake.ensureFolder("Sent");
  await createCommitterJob({
    db: trx,
    secrets,
    openProvider: async () => fake,
    openSender: async () => w.sender,
    compose: composeMessage,
    scope: { kind: "all" },
    sendScope: { kind: "all" },
    now: () => NOW,
  }).run();
  const sent = w.sender.sent[0];
  if (sent === undefined) throw new Error("nothing was sent");
  return sent.raw.toString("utf8").replace(/=\r\n/g, "");
}

describe("the name and the signature of the mailbox in the sent message", () => {
  test("1: a profile display name is the From name of a delegation", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertMailboxProfile(trx, w.ctx, w.mailboxId, { display_name: "Anna Nowak" });
      const raw = await sentRaw(trx, w);
      // The composer quotes a display name only when it must: the name is "Anna Nowak" either way.
      expect(raw).toMatch(new RegExp(`\\r\\nFrom: "?Anna Nowak"? <${w.address}>\\r\\n`));
    });
  });

  test("1b: no profile row: the owner name is the From name, as before", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const raw = await sentRaw(trx, w);
      expect(raw).toContain(`From: Owner <${w.address}>`);
    });
  });

  test("2: no profile row: the owner name is the signature", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const raw = await sentRaw(trx, w);
      expect(raw).toContain("\r\n\r\nOwner\r\n");
    });
  });

  test("2b: a profile row with a null signature: the owner name is the signature", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertMailboxProfile(trx, w.ctx, w.mailboxId, { display_name: "Anna Nowak", signature: null });
      const raw = await sentRaw(trx, w);
      expect(raw).toContain("\r\n\r\nOwner\r\n");
    });
  });

  test("3: a profile signature is the signature", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertMailboxProfile(trx, w.ctx, w.mailboxId, { signature: "Anna Nowak, Purchasing" });
      const raw = await sentRaw(trx, w);
      expect(raw).toContain("\r\n\r\nAnna Nowak, Purchasing\r\n");
    });
  });

  test("4: a profile row with no field set: the owner name signs", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertMailboxProfile(trx, w.ctx, w.mailboxId, {});
      const raw = await sentRaw(trx, w);
      expect(raw).toContain("\r\n\r\nOwner\r\n");
    });
  });

  test("5: the profile of another mailbox of the organization does not reach this mailbox", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const other = randomUUID();
      await trx
        .insertInto("mailboxes")
        .columns(["id", "org_id", "address", "imap_host", "imap_port", "smtp_host", "smtp_port", "capabilities"])
        .expression((eb) =>
          eb
            .selectFrom("mailboxes")
            .select([
              eb.val(other).as("id"),
              "org_id",
              eb.val(`other-${other}@x.test`).as("address"),
              "imap_host",
              "imap_port",
              "smtp_host",
              "smtp_port",
              "capabilities",
            ])
            .where("id", "=", w.mailboxId)
        )
        .execute();
      await insertMailboxProfile(trx, w.ctx, other, { display_name: "Other Name", signature: "Other signature" });
      const raw = await sentRaw(trx, w);
      expect(raw).toContain("\r\n\r\nOwner\r\n");
      expect(raw).not.toContain("Other");
    });
  });
});

describe("the approval view and the panel edit read the same profile", () => {
  test("6: the card text ends with the profile signature", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertMailboxProfile(trx, w.ctx, w.mailboxId, { signature: "Anna Nowak" });
      const send = await getSend(trx, w.ctx, w.sendId);
      if (send === undefined) throw new Error("no send");
      const { view } = await approvalViewFor(trx, w.ctx, send);
      expect(view.body.endsWith("\n\nAnna Nowak")).toBe(true);
    });
  });

  test("7: an edit that sends the text the card shows is `unchanged`; the same text with another signature is an edit", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertDefaultSettings(trx, w.ctx, w.mailboxId);
      await updateMailboxSettings(trx, w.ctx, w.mailboxId, {
        mode: "assist",
        toolSwitches: { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false },
      });
      await trx
        .updateTable("actions")
        .set({ status: "awaiting_approval", approved_at: null, approved_by: null, approved_via: null })
        .where("id", "=", w.sendId)
        .execute();
      await trx.updateTable("actions").set({ status: "ready" }).where("id", "=", w.draftId).execute();
      await insertMailboxProfile(trx, w.ctx, w.mailboxId, { signature: "Anna Nowak", display_name: "Anna Nowak" });
      const send = await getSend(trx, w.ctx, w.sendId);
      if (send === undefined) throw new Error("no send");
      const { view, subject } = await approvalViewFor(trx, w.ctx, send);
      const deps = {
        db: trx,
        hooks: delegationHooks({ db }),
        approvalHooks: noApprovalHooks,
        uidplus: async () => true,
      } as ApprovalDeps;
      const input = { userId: w.userId, via: "web" as const, now: NOW };
      expect(await editApproval(deps, w.ctx, w.sendId, { ...input, subject, body: view.body })).toEqual({
        kind: "unchanged",
      });
      const old = view.body.replace(/Anna Nowak$/, OTHER_SIGNATURE);
      expect(await editApproval(deps, w.ctx, w.sendId, { ...input, subject, body: old })).toMatchObject({
        kind: "edited",
      });
    });
  });
});
