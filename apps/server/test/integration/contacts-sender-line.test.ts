import { randomUUID } from "node:crypto";

import { activityPageSchema, approvalDetailSchema, approvalListSchema, textsFor, type SenderLine } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import type { SendScope } from "../../src/modules/actions";
import { getApprovalDetail, listApprovals } from "../../src/modules/channels/approvals-read";
import { readProfiles, type SenderLineDeps } from "../../src/modules/contacts";
import { listActivity } from "../../src/modules/reports/activity";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { Db } from "../../src/platform/db";

import { ago, KEY, newOrg, refresh, secondMailbox, NOW, type Org, type Trx } from "./contacts-fixtures";
import { insertDelegate, insertDraftAndSend, seedSenderActivity } from "./fixtures";
import { insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";

// Sender context, the sender line in Activity and Approvals. Each test fails when its guard is removed.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ANNA = "anna@acme.pl";
const query = { notRated: false, limit: 100, since: ago(60) };
const texts = textsFor("en");
const sendScope: SendScope = { kind: "all" };

// The profile reader with a count of its calls and the pairs of each call.
function spyDeps(trx: Trx) {
  const calls: { mailboxId: string; address: string }[][] = [];
  const deps: SenderLineDeps = {
    db: trx,
    credentialsKey: KEY,
    readProfiles: (readDeps, ctx, pairs, now) => {
      calls.push([...pairs]);
      return readProfiles(readDeps, ctx, pairs, now);
    },
  };
  return { deps, calls };
}

// `count` mails of `address` in the mailbox, the first `answered` of them answered, `sent` Sent mails to the address.
// The newest mail is `newest` days old.
async function seedSender(
  trx: Trx,
  org: Org,
  address: string,
  opts: { count: number; answered: number; sent: number; newest?: number }
): Promise<void> {
  await seedSenderActivity(trx, org.ctx, org.mailboxId, {
    address,
    mails: Array.from({ length: opts.count }, (_, index) => ({
      at: ago((opts.newest ?? 2) + index),
      category: "info" as const,
      answered: index < opts.answered,
    })),
    sent: Array.from({ length: opts.sent }, (_, index) => ({ at: ago(20 + index), to: [address] })),
  });
}

const sendersOf = (page: Awaited<ReturnType<typeof listActivity>>) => page.items.map((item) => item.sender);

describe("the activity page", () => {
  test("1. flag on: the line of the profile", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSender(trx, org, ANNA, { count: 8, answered: 6, sent: 3 });
      await refresh(trx, org);
      const { deps } = spyDeps(trx);
      const page = activityPageSchema.parse(await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts, deps));
      expect(page.items).toHaveLength(8);
      const expected: SenderLine = {
        relation: "known",
        received: 8,
        answered: 6,
        userMailsTo: 3,
        lastSeenDaysAgo: 2,
        days: 90,
      };
      for (const item of page.items) expect(item.sender).toEqual(expected);
      // Counts only: no address, no hash, no other key.
      expect(Object.keys(page.items[0]?.sender ?? {}).sort()).toEqual(
        ["answered", "days", "lastSeenDaysAgo", "received", "relation", "userMailsTo"].sort()
      );
    });
  });

  test("2. flag off: no sender key and no profile read; a page without the deps has none either", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSender(trx, org, ANNA, { count: 3, answered: 1, sent: 1 });
      await refresh(trx, org);
      await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
      const { deps, calls } = spyDeps(trx);
      const off = await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts, deps);
      expect(off.items).toHaveLength(3);
      for (const item of off.items) expect("sender" in item).toBe(false);
      expect(calls).toHaveLength(0);
      // The same bytes as a page read without the deps (the answer of before).
      const bare = await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts);
      expect(JSON.stringify(off)).toBe(JSON.stringify(bare));
    });
  });

  test("2b. the sender_suggestions and contact_wait flags alone do not show the line", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSender(trx, org, ANNA, { count: 2, answered: 1, sent: 0 });
      await refresh(trx, org);
      await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
      await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: true, actor: "cli", now: NOW });
      await setOrgFeature(trx, org.ctx, { flag: "contact_wait", enabled: true, actor: "cli", now: NOW });
      const page = await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts, spyDeps(trx).deps);
      for (const item of page.items) expect("sender" in item).toBe(false);
    });
  });

  test("3. a mail with a cleared from_address has sender null; its neighbours keep their line", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSender(trx, org, ANNA, { count: 3, answered: 1, sent: 0 });
      await refresh(trx, org);
      const oldest = await trx
        .selectFrom("emails")
        .select("id")
        .where("mailbox_id", "=", org.mailboxId)
        .orderBy("received_at", "asc")
        .executeTakeFirstOrThrow();
      await trx.updateTable("emails").set({ from_address: null }).where("id", "=", oldest.id).execute();
      const { deps, calls } = spyDeps(trx);
      const page = await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts, deps);
      const byId = new Map(page.items.map((item) => [item.emailId, item.sender]));
      expect(byId.get(oldest.id)).toBeNull();
      expect([...byId.values()].filter((line) => line !== null)).toHaveLength(2);
      expect(calls).toHaveLength(1);
    });
  });

  test("3b. a page with no address makes no profile read; a sender without a profile row is null", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSender(trx, org, ANNA, { count: 2, answered: 0, sent: 0 });
      // No pass ran: no profile row.
      const { deps, calls } = spyDeps(trx);
      const page = await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts, deps);
      expect(sendersOf(page)).toEqual([null, null]);
      expect(calls).toHaveLength(1);
      await trx.updateTable("emails").set({ from_address: null }).where("mailbox_id", "=", org.mailboxId).execute();
      const cleared = await listActivity(trx as unknown as Db, org.ctx, query, NOW, texts, deps);
      expect(sendersOf(cleared)).toEqual([null, null]);
      expect(calls).toHaveLength(1);
    });
  });

  test("5. a page of 50 items from two mailboxes: one profile read, both lines filled, each from its own mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await secondMailbox(trx, a);
      await seedSender(trx, a, ANNA, { count: 25, answered: 5, sent: 0, newest: 1 });
      await seedSender(trx, b, ANNA, { count: 25, answered: 10, sent: 0, newest: 1 });
      await refresh(trx, a);
      await refresh(trx, b);
      const { deps, calls } = spyDeps(trx);
      const page = await listActivity(trx as unknown as Db, a.ctx, { ...query, limit: 50 }, NOW, texts, deps);
      expect(page.items).toHaveLength(50);
      expect(calls).toHaveLength(1);
      // The pairs are the distinct (mailbox, address) pairs of the page.
      expect(calls[0]?.map((pair) => pair.mailboxId).sort()).toEqual([a.mailboxId, b.mailboxId].sort());
      const answeredOf = (mailboxId: string) =>
        new Set(page.items.filter((item) => item.mailboxId === mailboxId).map((item) => item.sender?.answered));
      expect(answeredOf(a.mailboxId)).toEqual(new Set([5]));
      expect(answeredOf(b.mailboxId)).toEqual(new Set([10]));
    });
  });
});

describe("the approvals", () => {
  test("4. a follow-up has sender null, also when its recipient has a profile; a reply from the sender has the line", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // The follow-up goes to a person with a profile: the line must still be about no one.
      await seedSender(trx, org, "boss@acme.pl", { count: 4, answered: 2, sent: 2 });
      await seedSender(trx, org, ANNA, { count: 8, answered: 6, sent: 3 });
      await refresh(trx, org);
      const delegate = await insertDelegate(trx, org.ctx, { email: "ola@acme.pl" });
      const reply = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
        kind: "delegation",
        delegateId: delegate,
        to: "ola@acme.pl",
        from: ANNA,
        createdAt: ago(0, 1),
        notifiedAt: ago(0, 1),
      });
      const second = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
        kind: "delegation",
        delegateId: delegate,
        to: "ola@acme.pl",
        from: "boss@acme.pl",
        createdAt: ago(0, 2),
        notifiedAt: ago(0, 2),
      });
      const followUp = await insertFollowUp(trx, org.ctx, org.mailboxId, randomUUID(), {
        to: ["boss@acme.pl"],
        cc: [],
        createdAt: ago(0, 1),
        notifiedAt: ago(0, 1),
      });
      const { deps, calls } = spyDeps(trx);
      const readDeps = { db: trx as unknown as Db, sendScope, sender: deps };
      const list = approvalListSchema.parse(await listApprovals(readDeps, org.ctx, NOW));
      expect(list.items).toHaveLength(3);
      // One read for the whole list, with the two sender pairs (the follow-up has none).
      expect(calls).toHaveLength(1);
      expect(calls[0]).toHaveLength(2);
      const byId = new Map(list.items.map((item) => [item.id, item]));
      expect(byId.get(followUp.sendId)?.sender).toBeNull();
      expect(byId.get(second.sendId)?.sender?.received).toBe(4);
      expect(byId.get(reply.sendId)?.sender).toEqual({
        relation: "known",
        received: 8,
        answered: 6,
        userMailsTo: 3,
        lastSeenDaysAgo: 2,
        days: 90,
      });

      // The detail reads the same line, with its own single read.
      const detail = approvalDetailSchema.parse(await getApprovalDetail(readDeps, org.ctx, reply.sendId, NOW));
      expect(detail.sender?.answered).toBe(6);
      expect(calls).toHaveLength(2);
      const followDetail = approvalDetailSchema.parse(await getApprovalDetail(readDeps, org.ctx, followUp.sendId, NOW));
      expect(followDetail.sender).toBeNull();
    });
  });

  test("4b. flag off or no deps: no sender key; a cleared address: null", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSender(trx, org, ANNA, { count: 3, answered: 1, sent: 0 });
      await refresh(trx, org);
      const delegate = await insertDelegate(trx, org.ctx, { email: "ola@acme.pl" });
      const reply = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
        delegateId: delegate,
        to: "ola@acme.pl",
        from: ANNA,
        createdAt: ago(0, 1),
        notifiedAt: ago(0, 1),
      });
      const { deps } = spyDeps(trx);
      const base = { db: trx as unknown as Db, sendScope };
      const on = await listApprovals({ ...base, sender: deps }, org.ctx, NOW);
      expect(on.items[0]?.sender?.received).toBe(3);
      const bare = await listApprovals(base, org.ctx, NOW);
      expect("sender" in (bare.items[0] ?? {})).toBe(false);
      await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
      const off = await listApprovals({ ...base, sender: deps }, org.ctx, NOW);
      expect(JSON.stringify(off)).toBe(JSON.stringify(bare));
      await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: true, actor: "cli", now: NOW });
      await trx.updateTable("emails").set({ from_address: null }).where("id", "=", reply.emailId).execute();
      const cleared = await getApprovalDetail({ ...base, sender: deps }, org.ctx, reply.sendId, NOW);
      expect(cleared?.sender).toBeNull();
    });
  });
});
