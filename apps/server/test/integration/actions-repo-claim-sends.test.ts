import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { claimActions, countClaimable, type SendClaimFilter } from "../../src/modules/actions";
import { NO_TEST_SENDERS } from "../../src/modules/mail";

import { NOW, ALL, ago, claimOpts, countOpts, setupOrgs, approvedNow, idsOf } from "./actions-repo-helpers";
import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("claimActions: drafts and sends (D16, D17)", () => {
  const MIN = MINUTE_MS;

  test("1: a ready draft is claimed while its send waits; the send is not", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        createdAt: ago(HOUR_MS),
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.id)).toEqual([pair.draftId]);
      expect(claimed[0]).toMatchObject({ type: "create_draft", status: "ready", depends_on_action_id: null });
    });
  });

  test("2: an approved send with an applied draft is claimed with the mail fields", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
        bodyText: "Hello body",
        inReplyTo: "<in@x.test>",
        referencesHeader: "<r1@x.test> <in@x.test>",
        toAddresses: ["me@x.test", "you@x.test"],
        to: "d@x.test",
        draftProviderResult: { uid: 5 },
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts());
      expect(claimed.map((row) => row.id)).toEqual([pair.sendId]);
      const [send] = claimed;
      expect(send).toMatchObject({
        type: "send",
        status: "approved",
        depends_on_action_id: pair.draftId,
        outgoing_message_id: null,
        provider_result: null,
        payload: { kind: "delegation", to: ["d@x.test"] },
      });
      expect(send?.approved_at?.getTime()).toBe(ago(MIN).getTime());
      expect(send?.created_at.getTime()).toBe(ago(HOUR_MS).getTime());
      expect(send?.original_created_at).toBeNull();
      expect(send?.email).toMatchObject({
        body_text: "Hello body",
        in_reply_to: "<in@x.test>",
        references_header: "<r1@x.test> <in@x.test>",
        to_addresses: ["me@x.test", "you@x.test"],
      });
      expect(typeof send?.email?.thread_key).toBe("string");
    });
  });

  test("3: a draft waits for its send to wait too: ready draft + approved send claims nothing, + awaiting claims the draft", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      // A draft is made only while its send waits: with the send `approved` the draft is not claimed either.
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).toEqual([]);
      await trx.updateTable("actions").set({ status: "awaiting_approval" }).where("id", "=", pair.sendId).execute();
      expect((await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).map((row) => row.id)).toEqual([pair.draftId]);
    });
  });

  test("3b: a ready draft whose send ended is not claimed or counted; an applying one is (recovery)", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setupOrgs(trx);
      const rejected = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        sendStatus: "rejected",
        createdAt: ago(HOUR_MS),
      });
      await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        sendStatus: "expired",
        createdAt: ago(HOUR_MS),
      });
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).toEqual([]);
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts())).toEqual({
        total: 0,
        mailboxChanging: 0,
        sending: 0,
      });

      await trx.updateTable("actions").set({ status: "applying" }).where("id", "=", rejected.draftId).execute();
      expect((await claimActions(trx, a.ctx, a.mailboxId, claimOpts())).map((row) => row.id)).toEqual([
        rejected.draftId,
      ]);
    });
  });

  test("4: the send filter: none holds back, self matches in SQL; the recovery ignores it", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        to: "B@x.test",
        createdAt: ago(HOUR_MS),
      });
      const none: SendClaimFilter = { kind: "none" };
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL, 50, none))).toEqual([]);
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts(ALL, none))).toEqual({
        total: 0,
        mailboxChanging: 0,
        sending: 0,
      });
      const other: SendClaimFilter = { kind: "self", addresses: ["c@x.test"] };
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL, 50, other))).toEqual([]);
      const self: SendClaimFilter = { kind: "self", addresses: ["b@x.test"] };
      expect(await countClaimable(trx, a.ctx, a.mailboxId, countOpts(ALL, self))).toEqual({
        total: 1,
        mailboxChanging: 0,
        sending: 1,
      });
      expect(idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL, 50, self)))).toEqual([pair.sendId]);
    });
  });

  test("4: self needs every recipient in the list and a non-empty list of recipients", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const two = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: ["b@x.test", "c@x.test"] }) })
        .where("id", "=", two.sendId)
        .execute();
      const empty = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: [] }) })
        .where("id", "=", empty.sendId)
        .execute();
      const broken = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: approvedNow(userId),
        createdAt: ago(HOUR_MS),
      });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: "b@x.test" }) })
        .where("id", "=", broken.sendId)
        .execute();
      const self: SendClaimFilter = { kind: "self", addresses: ["b@x.test"] };
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL, 50, self))).toEqual([]);
      self.addresses.push("c@x.test");
      expect(idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL, 50, self)))).toEqual([two.sendId]);
    });
  });

  test("4b: an applying send with locked_at null is claimed under send none", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const pair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved: approvedNow(userId),
        outgoingMessageId: "<out@x.test>",
        createdAt: ago(HOUR_MS),
      });
      const claimed = await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL, 50, { kind: "none" }));
      expect(claimed.map((row) => row.id)).toEqual([pair.sendId]);
      expect(claimed[0]).toMatchObject({ status: "applying", outgoing_message_id: "<out@x.test>" });
    });
  });

  test("5: the mailbox filter gates drafts: none, synthetic, all", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setupOrgs(trx);
      const synthetic = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        messageId: "<seed-1@ea-seed.test>",
        createdAt: ago(2 * HOUR_MS),
      });
      const real = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "ready",
        messageId: "<real-1@example.com>",
        createdAt: ago(HOUR_MS),
      });
      expect(await claimActions(trx, a.ctx, a.mailboxId, claimOpts({ kind: "none" }))).toEqual([]);
      expect(
        idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts({ kind: "synthetic", testMail: NO_TEST_SENDERS })))
      ).toEqual([synthetic.draftId]);
      await trx.updateTable("actions").set({ locked_at: null }).execute();
      expect(idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts(ALL)))).toEqual(
        [synthetic.draftId, real.draftId].sort()
      );
    });
  });

  test("6: next_attempt_at and the lock rule apply to drafts and sends", async () => {
    await withRollback(db, async (trx) => {
      const { a, userId } = await setupOrgs(trx);
      const approved = approvedNow(userId);
      const draftDue = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "applying",
        createdAt: ago(HOUR_MS),
      });
      const draftWait = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "applying",
        createdAt: ago(HOUR_MS),
      });
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: ago(MIN) })
        .where("id", "=", draftDue.draftId)
        .execute();
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: new Date(NOW.getTime() + MIN) })
        .where("id", "=", draftWait.draftId)
        .execute();
      const sendStale = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved,
        lockedAt: ago(11 * MIN),
        createdAt: ago(HOUR_MS),
      });
      const sendFresh = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "applying",
        approved,
        lockedAt: ago(MIN),
        createdAt: ago(HOUR_MS),
      });
      const approvedStale = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved,
        lockedAt: ago(11 * MIN),
        createdAt: ago(HOUR_MS),
      });
      const approvedFresh = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        sendStatus: "approved",
        approved,
        lockedAt: ago(MIN),
        createdAt: ago(HOUR_MS),
      });
      const claimed = idsOf(await claimActions(trx, a.ctx, a.mailboxId, claimOpts()));
      expect(claimed).toEqual([draftDue.draftId, sendStale.sendId, approvedStale.sendId].sort());
      expect(claimed).not.toContain(draftWait.draftId);
      expect(claimed).not.toContain(sendFresh.sendId);
      expect(claimed).not.toContain(approvedFresh.sendId);
    });
  });
});
