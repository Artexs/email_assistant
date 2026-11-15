import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { onSentOff } from "../../src/modules/loops";
import { noSentSwitchHooks, setSentSync, type SentSwitchHooks } from "../../src/modules/mail";
import { configureFeatures } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { insertLoopRow, insertSentRow } from "./loops-fixtures";
import { ago, newOrg, NOW, siblingMailbox, type Org } from "./mail-sent-fixtures";

// Switching "Track my sent mail" off ends what the Sent mail started (F116 stage 8, step 3).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

type Trx = Transaction<DB>;

const AT = new Date("2026-11-20T10:00:00Z");
const ACTOR = "user-1";

const off = (trx: Trx, org: Org, hooks: SentSwitchHooks = sentSwitchHooks) =>
  setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: ACTOR, at: AT }, hooks);

async function loopRow(trx: Trx, id: string) {
  return trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("onSentOff through setSentSync", () => {
  test("T7: two open loops end sent_off with cleared texts; a closed loop stays as it is", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const sent = await insertSentRow(trx, org.ctx, org.mailboxId);
      const waiting = await insertLoopRow(trx, org.ctx, org.mailboxId, { sent_email_id: sent });
      const promised = await insertLoopRow(trx, org.ctx, org.mailboxId, { kind: "promised", sent_email_id: sent });
      const closed = await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "replied",
        closed_at: ago(1000),
      });
      const closedBefore = await loopRow(trx, closed);

      expect(await off(trx, org)).toEqual({ result: "changed", deleted: 1 });

      for (const id of [waiting, promised]) {
        const loop = await loopRow(trx, id);
        expect(loop).toMatchObject({
          status: "closed",
          close_reason: "sent_off",
          closed_by_user_id: null,
          subject: null,
          text: null,
          to_addresses: [],
          cc_addresses: [],
          counterpart: null,
          sent_email_id: null,
        });
        expect(loop.closed_at?.getTime()).toBe(AT.getTime());
        expect(loop.texts_cleared_at?.getTime()).toBe(AT.getTime());
      }
      expect(await loopRow(trx, closed)).toEqual(closedBefore);
      const audit = await trx
        .selectFrom("audit_log")
        .select(["actor", "data"])
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "loop.closed")
        .execute();
      expect(audit).toHaveLength(2);
      for (const entry of audit) expect(entry).toMatchObject({ actor: "system", data: { reason: "sent_off" } });
      expect(JSON.stringify(audit)).not.toContain("@x.test");
    });
  });

  test("T8: a loop of another mailbox, of another organization and a switch that stays on keep their loops open", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const otherOrg = await newOrg(trx);
      const mine = await insertLoopRow(trx, org.ctx, org.mailboxId);
      const otherMailbox = await insertLoopRow(trx, otherOrg.ctx, otherOrg.mailboxId);
      // A second mailbox of the same organization.
      const second = await siblingMailbox(trx, org);
      const inSecond = await insertLoopRow(trx, org.ctx, second.mailboxId);

      await off(trx, org);

      expect((await loopRow(trx, mine)).status).toBe("closed");
      expect((await loopRow(trx, inSecond)).status).toBe("open");
      expect((await loopRow(trx, inSecond)).subject).not.toBeNull();
      expect((await loopRow(trx, otherMailbox)).status).toBe("open");
    });
  });

  test("onSentOff with the organization of another mailbox closes nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await newOrg(trx);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);

      expect(await onSentOff(trx, other.ctx, { mailboxId: org.mailboxId, at: AT })).toBe(0);

      expect((await loopRow(trx, id)).status).toBe("open");
      expect(await onSentOff(trx, org.ctx, { mailboxId: org.mailboxId, at: AT })).toBe(1);
    });
  });

  test("no change when the switch is already off, and none when it goes on", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { switchOn: false });
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);

      expect(await off(trx, org)).toEqual({ result: "same", deleted: 0 });
      const on = await setSentSync(
        trx,
        org.ctx,
        org.mailboxId,
        { enabled: true, actor: ACTOR, at: AT },
        sentSwitchHooks
      );
      expect(on.result).toBe("changed");

      expect((await loopRow(trx, id)).status).toBe("open");
    });
  });

  test("the hook runs inside the switch transaction before the sent mail is deleted, only when the switch goes off", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await insertSentRow(trx, org.ctx, org.mailboxId);
      const calls: { sentRows: number; mailboxId: string; at: number }[] = [];
      const spy: SentSwitchHooks = {
        onDisabled: async (inner, ctx, input) => {
          const rows = await inner.selectFrom("sent_emails").select("id").where("org_id", "=", ctx.orgId).execute();
          calls.push({ sentRows: rows.length, mailboxId: input.mailboxId, at: input.at.getTime() });
        },
      };

      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: ACTOR, at: AT }, spy);
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: ACTOR, at: AT }, spy);
      await setSentSync(trx, org.ctx, org.mailboxId, { enabled: true, actor: ACTOR, at: NOW }, spy);

      expect(calls).toEqual([{ sentRows: 1, mailboxId: org.mailboxId, at: AT.getTime() }]);
    });
  });

  test("the default hook changes no loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = await insertLoopRow(trx, org.ctx, org.mailboxId);

      await off(trx, org, noSentSwitchHooks);

      expect((await loopRow(trx, id)).status).toBe("open");
    });
  });
});
