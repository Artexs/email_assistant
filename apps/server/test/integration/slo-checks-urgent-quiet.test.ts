import { afterAll, describe, expect, test } from "bun:test";

import { checkUrgentLatency } from "../../src/modules/operator";
import { upsertOrgFeature } from "../../src/modules/tenancy";

import { addMember, createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";
import {
  type Trx,
  cfg,
  noTestMail,
  at,
  NOW,
  makeInRollback,
  setMailbox,
  urgentOrg,
  urgentMail,
  sentNotice,
} from "./slo-checks-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const inRollback = makeInRollback(db);

// With `user_quiet_hours` on, the wait leaves out the own quiet hours of the user of the notice.
// 2026-11-19 is CET (UTC+1): local time is UTC + 1 h.
describe("urgent latency with own quiet hours", () => {
  const LONG_NIGHT = { quiet_start: "21:00", quiet_end: "08:00" };
  const DAY_BEFORE = "2026-11-19";

  async function setHours(trx: Trx, orgId: string, userId: string, hours: typeof LONG_NIGHT | null) {
    await trx
      .updateTable("memberships")
      .set(hours ?? { quiet_start: null, quiet_end: null })
      .where("org_id", "=", orgId)
      .where("user_id", "=", userId)
      .execute();
  }

  async function flag(trx: Trx, org: { orgId: string; userId: string }, enabled: boolean) {
    await upsertOrgFeature(
      trx,
      { orgId: org.orgId },
      { flag: "user_quiet_hours", enabled, setBy: org.userId, setAt: NOW }
    );
  }

  // Urgent mail at 21:30 local (20:30Z the day before NOW), on an organization whose mailbox changed before it.
  async function lateMail(trx: Trx) {
    const org = await urgentOrg(trx);
    await setMailbox(trx, org.mailboxId, { status_changed_at: at("08:00", "2026-11-18") });
    const emailId = await urgentMail(trx, org, { receivedAt: at("20:30", DAY_BEFORE) });
    return { org, emailId };
  }

  const NOW_0730 = at("07:30", "2026-11-20");
  const started = at("00:00", DAY_BEFORE);
  const check = (trx: Trx) => checkUrgentLatency(trx, NOW_0730, cfg, started, noTestMail);

  test("6. hours 21:00–08:00 and a notice at 08:00 local: 0 minutes late, clear; the flag off: 90 minutes, firing", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      await flag(trx, org, true);
      expect((await check(trx)).check).toEqual({
        kind: "slo_urgent_latency",
        state: "clear",
        facts: { mails: 0, max_wait_min: 0 },
      });
      await flag(trx, org, false);
      const off = await check(trx);
      expect(off.check.state).toBe("firing");
      expect(off.check.facts).toEqual({ mails: 1, max_wait_min: 90 });
    });
  });

  test("6b. two pending rows (users 21:00–08:00 and no quiet hours), no sent row, now 08:30 local: the larger wait counts", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      const otherId = await addMember(trx, org.orgId);
      // Equal times: this user has no quiet hours, so the whole wait counts. The user in quiet hours must not hide it.
      await setHours(trx, org.orgId, otherId, { quiet_start: "10:00", quiet_end: "10:00" });
      await flag(trx, org, true);
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), { status: "pending" });
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), {
        status: "pending",
        userId: otherId,
        key: "other",
      });
      const reading = await check(trx);
      // Own hours of the first user: 08:00 to 08:30 is 30 minutes. The second user has no quiet hours: 21:30 to 08:30 is 660.
      expect(reading.check.state).toBe("firing");
      expect(reading.check.facts).toEqual({ mails: 1, max_wait_min: 660 });
      // The flag off: both users have the default hours, 30 + 90 = 120.
      await flag(trx, org, false);
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 120 });
    });
  });

  test("6b2. a user in quiet hours alone does not raise an alarm; the user without quiet hours who waits does", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await flag(trx, org, true);
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), { status: "pending" });
      // Now 07:30Z is 08:30 local: 21:00–08:00 leaves 30 minutes, a firing wait over the 10 minute limit.
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 30 });
      // At 07:05Z (08:05 local) it leaves 5 minutes: clear.
      const early = await checkUrgentLatency(trx, at("07:05", "2026-11-20"), cfg, started, noTestMail);
      expect(early.check.state).toBe("clear");
    });
  });

  test("6c. the user of the sent row gives the hours, not another member's pending row", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      const otherId = await addMember(trx, org.orgId);
      await setHours(trx, org.orgId, otherId, LONG_NIGHT);
      await flag(trx, org, true);
      // The owner (default hours) got the notice at 08:00 local; the other member has a pending row with long hours.
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), {
        status: "pending",
        userId: otherId,
        key: "other",
      });
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 90 });
    });
  });

  test("6d. no outbox row yet: the default hours count, also with the flag on", async () => {
    await inRollback(async (trx) => {
      const { org } = await lateMail(trx);
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await flag(trx, org, true);
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 120 });
    });
  });

  test("6e. two sent notices of two users: the first sent one gives the hours, not the last", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      const otherId = await addMember(trx, org.orgId);
      await setHours(trx, org.orgId, otherId, LONG_NIGHT);
      await flag(trx, org, true);
      // The owner (default hours) got the first notice at 08:00 local; the other member (21:00–08:00) got a later one.
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      await sentNotice(trx, org, emailId, at("07:20", "2026-11-20"), { userId: otherId, key: "other" });
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 90 });
    });
  });

  test("6f. a user of two organizations: the pending row takes the hours of its own organization only", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      const elsewhere = await createOrgWithMailbox(trx);
      // The same user is a member of another organization with other hours (default).
      await trx
        .insertInto("memberships")
        .values({ org_id: elsewhere.orgId, user_id: org.userId, role: "assistant" })
        .execute();
      await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
      await flag(trx, org, true);
      await sentNotice(trx, org, emailId, at("20:31", DAY_BEFORE), { status: "pending" });
      // Own hours of this organization: 30 minutes. A join that ignores the organization would add the default hours (120).
      expect((await check(trx)).check.facts).toEqual({ mails: 1, max_wait_min: 30 });
    });
  });

  test.each([true, false])(
    "6g. two organizations in one reading, the flag on in the %s one first: the flag of each counts for its own mail",
    async (onFirst) => {
      await inRollback(async (trx) => {
        const make = async (receivedAt: Date, on: boolean) => {
          const org = await urgentOrg(trx);
          await setMailbox(trx, org.mailboxId, { status_changed_at: at("08:00", "2026-11-18") });
          const emailId = await urgentMail(trx, org, { receivedAt });
          await setHours(trx, org.orgId, org.userId, LONG_NIGHT);
          await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
          await flag(trx, org, on);
          return emailId;
        };
        // The mail that was received first is read first: its flag is the one that a leaking cache would copy.
        const first = await make(at("20:30", DAY_BEFORE), onFirst);
        const second = await make(at("20:31", DAY_BEFORE), !onFirst);
        const reading = await check(trx);
        // Flag on: own hours 21:00–08:00 leave 0 minutes. Flag off: the default hours leave a firing wait.
        expect(reading.ids).toEqual([onFirst ? second : first]);
        expect(reading.check.facts.mails).toBe(1);
      });
    }
  );

  test("6h. a database error of the flag read fails the reading; it is not a bad time zone", async () => {
    await inRollback(async (trx) => {
      const { org, emailId } = await lateMail(trx);
      await sentNotice(trx, org, emailId, at("07:00", "2026-11-20"));
      const flaky = new Proxy(trx, {
        get(target, property) {
          if (property === "selectFrom") {
            return (table: string) => {
              if (table === "org_features") throw new Error("database down");
              return (target.selectFrom as (t: string) => unknown)(table);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      const warnings: string[] = [];
      await expect(
        checkUrgentLatency(flaky, NOW_0730, cfg, started, noTestMail, { warn: (event) => void warnings.push(event) })
      ).rejects.toThrow("database down");
      expect(warnings).toEqual([]);
    });
  });
});
