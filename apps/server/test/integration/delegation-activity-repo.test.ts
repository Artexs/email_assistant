import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { delegationCountsByDelegateAddress } from "../../src/modules/delegation";

import { ago, newOrg, NOW, secondMailbox, type Org, type Trx } from "./contacts-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The delegation reader of the sender activity pass: delegations of one mailbox per address of their delegate. The values are
// fixed. The tenant test calls the reader with the context of one organization and the mailbox of another.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const ADDRESS = "boss@example.com";

const options = (mailboxId: string) => ({ mailboxId, since: new Date(NOW.getTime() - 90 * DAY_MS), until: NOW });

// One delegation of `delegateId` made `days` before the fixed clock, in the mailbox of `org`.
async function delegate(trx: Trx, org: Org, delegateId: string, days: number): Promise<void> {
  const created = ago(days);
  const { emailId, draftId, sendId } = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
    delegateId,
    to: ADDRESS,
    createdAt: created,
  });
  await insertDelegation(trx, org.ctx, {
    mailboxId: org.mailboxId,
    emailId,
    delegateId,
    draftActionId: draftId,
    sendActionId: sendId,
    createdAt: created,
  });
}

describe("delegationCountsByDelegateAddress", () => {
  test("1 an active delegate: the delegations in the window count, the one at 91 days does not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertDelegate(trx, org.ctx, { email: ADDRESS });
      for (const days of [1, 30, 89, 91]) await delegate(trx, org, id, days);
      expect(await delegationCountsByDelegateAddress(trx, org.ctx, options(org.mailboxId))).toEqual([
        { address: ADDRESS, delegations: 3 },
      ]);
    });
  });

  test("2 an inactive delegate has no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const active = await insertDelegate(trx, org.ctx, { email: ADDRESS });
      const inactive = await insertDelegate(trx, org.ctx, { email: "gone@example.com", active: false });
      await delegate(trx, org, active, 3);
      for (const days of [2, 4]) await delegate(trx, org, inactive, days);
      expect(await delegationCountsByDelegateAddress(trx, org.ctx, options(org.mailboxId))).toEqual([
        { address: ADDRESS, delegations: 1 },
      ]);
    });
  });

  test("3 the delegations of a second mailbox of the organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await secondMailbox(trx, org);
      const id = await insertDelegate(trx, org.ctx, { email: ADDRESS });
      await delegate(trx, org, id, 5);
      await delegate(trx, other, id, 6);
      await delegate(trx, other, id, 7);
      expect(await delegationCountsByDelegateAddress(trx, org.ctx, options(org.mailboxId))).toEqual([
        { address: ADDRESS, delegations: 1 },
      ]);
      expect(await delegationCountsByDelegateAddress(trx, org.ctx, options(other.mailboxId))).toEqual([
        { address: ADDRESS, delegations: 2 },
      ]);
    });
  });

  test("4 another organization's rows never count; its mailbox gives nothing for this context", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const mine = await insertDelegate(trx, a.ctx, { email: ADDRESS });
      for (const days of [1, 30, 89]) await delegate(trx, a, mine, days);
      const theirs = await insertDelegate(trx, b.ctx, { email: ADDRESS });
      for (const days of [1, 2, 3, 4]) await delegate(trx, b, theirs, days);
      expect(await delegationCountsByDelegateAddress(trx, a.ctx, options(a.mailboxId))).toEqual([
        { address: ADDRESS, delegations: 3 },
      ]);
      expect(await delegationCountsByDelegateAddress(trx, a.ctx, options(b.mailboxId))).toEqual([]);
    });
  });

  // The column CHECK of `delegates.email` forbids capitals, so the rule form shows on the final sigma: the stored `ς` comes back
  // as `σ` (the folds of `normalizedAddress`).
  test("5 a delegate address comes back in the rule form", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertDelegate(trx, org.ctx, { email: "boς@example.com" });
      await delegate(trx, org, id, 2);
      expect(await delegationCountsByDelegateAddress(trx, org.ctx, options(org.mailboxId))).toEqual([
        { address: "boσ@example.com", delegations: 1 },
      ]);
    });
  });
});
