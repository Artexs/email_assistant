import { format } from "node:util";

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { contactWaitFor } from "../../src/modules/contacts";
import { analyzeSent, loopItemsOf, writeExtraction } from "../../src/modules/loops";
import type { SentCandidate } from "../../src/modules/loops/analysis-repo";
import type { Extraction } from "../../src/modules/loops/extractor";
import { toLoopRow } from "../../src/modules/loops/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { senderKeyHash } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { secondMailbox } from "./contacts-fixtures";
import { insertDelegate } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  type Answer,
  ASK,
  depsOf,
  FRI,
  fakeExtractor,
  loopsOf,
  loopsOrg,
  LOOPS_KEY,
  RUN_AT,
  sentMail,
  WED,
} from "./loops-analyze-fixtures";
import type { Org } from "./mail-sent-fixtures";

// The wait of a new waiting or delegated loop comes from the usual reply time of its counterpart (the profile of the
// contact), when the flags `sender_context` and `contact_wait` are on and the profile has 5 reply samples. The clock is
// fixed (the run is Friday 2026-11-20 11:00 UTC), the zone is Europe/Warsaw.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const ANNA = "anna@example.test";
const CC = "kim@example.test";
// The profile of the contact: the median of the contact's replies is 20 hours (the wait is 2 working days), the median of
// the replies of the user is 100 hours (a reader that takes the wrong median gets 7 working days).
const THEIR_HOURS = 20;
const USER_HOURS = 100;

async function flags(trx: Trx, org: Org, on: { context?: boolean; wait?: boolean } = {}) {
  const set = (flag: string, enabled: boolean) =>
    setOrgFeature(trx, org.ctx, { flag, enabled, actor: "cli", now: RUN_AT });
  await set("sender_context", on.context ?? true);
  await set("contact_wait", on.wait ?? true);
}

async function profile(
  trx: Trx,
  org: Org,
  address: string,
  over: { samples?: number; their?: number | null; mailboxId?: string; orgId?: string } = {}
) {
  await trx
    .insertInto("sender_profiles")
    .values({
      org_id: over.orgId ?? org.ctx.orgId,
      mailbox_id: over.mailboxId ?? org.mailboxId,
      key_hash: senderKeyHash(LOOPS_KEY, over.orgId ?? org.ctx.orgId, address),
      relation: "known",
      reply_samples_theirs: over.samples ?? 5,
      median_their_reply_hours: over.their === undefined ? THEIR_HOURS : over.their,
      median_user_reply_hours: USER_HOURS,
      last_seen_at: RUN_AT,
    })
    .execute();
}

async function analyse(trx: Trx, org: Org, answer: Answer = ASK) {
  const fake = fakeExtractor(answer);
  await analyzeSent(depsOf(trx, fake), org.ctx, org.mailboxId, { now: RUN_AT, limit: 20 });
  return loopsOf(trx, org);
}

// One loop of the org (a test makes one mail).
async function only(trx: Trx, org: Org, answer?: Answer) {
  const loops = await analyse(trx, org, answer);
  expect(loops).toHaveLength(1);
  return loops[0] as (typeof loops)[number];
}

// Wednesday 2026-11-18, mail at 10:00Z. 17:00 Warsaw (UTC+1) is 16:00Z.
const FRI_1700 = new Date("2026-11-20T16:00:00Z");
const MON_1700 = new Date("2026-11-23T16:00:00Z");
const TUE_1700 = new Date("2026-11-24T16:00:00Z");

describe("the wait of a new loop from the usual reply time of the contact", () => {
  test("T1: 5 samples and a median of 20 h: due in 2 working days at 17:00, source contact, usual reply 1 day", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA);
      await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
      const loop = await only(trx, org);
      expect(loop.kind).toBe("waiting");
      expect(loop.due_source).toBe("contact");
      expect(loop.due_at.getTime()).toBe(FRI_1700.getTime());
      expect(loop.usual_reply_days).toBe(1);
    });
  });

  test("T2: 4 samples: the default wait, no usual reply", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA, { samples: 4 });
      await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
      const loop = await only(trx, org);
      expect(loop.due_source).toBe("default");
      expect(loop.due_at.getTime()).toBe(MON_1700.getTime());
      expect(loop.usual_reply_days).toBeNull();
    });
  });

  test("T2b: no profile, or a profile with no median: the default wait", async () => {
    await withRollback(db, async (trx) => {
      const none = await loopsOrg(trx);
      await flags(trx, none);
      await sentMail(trx, none, { sentAt: WED, to: [ANNA] });
      expect((await only(trx, none)).due_source).toBe("default");
      const empty = await loopsOrg(trx);
      await flags(trx, empty);
      await profile(trx, empty, ANNA, { their: null, samples: 9 });
      await sentMail(trx, empty, { sentAt: WED, to: [ANNA] });
      expect((await only(trx, empty)).due_source).toBe("default");
    });
  });

  test("T3: flag contact_wait off, or sender_context off with contact_wait on: the default wait", async () => {
    await withRollback(db, async (trx) => {
      for (const on of [{ wait: false }, { context: false }]) {
        const org = await loopsOrg(trx);
        await flags(trx, org, on);
        await profile(trx, org, ANNA);
        await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
        const loop = await only(trx, org);
        expect([on, loop.due_source, loop.usual_reply_days]).toEqual([on, "default", null]);
        expect(loop.due_at.getTime()).toBe(MON_1700.getTime());
      }
    });
  });

  test("T4: a stated date in the mail wins: source stated, no usual reply", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA);
      await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
      const loop = await only(trx, org, { ...ASK, due: { kind: "date", date: "2026-11-27" } });
      expect(loop.due_source).toBe("stated");
      expect(loop.usual_reply_days).toBeNull();
    });
  });

  test("T5: a delegated loop uses the profile of the delegate; a Cc-only waiting loop uses the profile of the Cc address", async () => {
    await withRollback(db, async (trx) => {
      const delegated = await loopsOrg(trx);
      await flags(trx, delegated);
      await insertDelegate(trx, delegated.ctx, { name: "Dana", email: "dana@example.test" });
      // The delegate has a long reply time (4 working days); the first To has none: only the delegate decides.
      await profile(trx, delegated, "dana@example.test", { their: 72 });
      await profile(trx, delegated, ANNA, { their: 5 });
      await sentMail(trx, delegated, { sentAt: WED, to: [ANNA, "dana@example.test"] });
      const first = await only(trx, delegated);
      expect(first).toMatchObject({ kind: "delegated", counterpart: "dana@example.test", due_source: "contact" });
      expect(first.usual_reply_days).toBe(3);
      // 72 h * 1.5 = 108 h = 4.5 days, rounded up to 5 working days after Wednesday: Wednesday 25 Nov.
      expect(first.due_at.getTime()).toBe(new Date("2026-11-25T16:00:00Z").getTime());

      const cc = await loopsOrg(trx);
      await flags(trx, cc);
      await profile(trx, cc, CC);
      await sentMail(trx, cc, { sentAt: WED, to: [], cc: [CC] });
      const second = await only(trx, cc);
      expect(second).toMatchObject({ kind: "waiting", counterpart: CC, due_source: "contact" });
      expect(second.due_at.getTime()).toBe(FRI_1700.getTime());
    });
  });

  test("T6: the contact wins over the loop_wait_days of the owner (5 days against 2)", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await trx
        .updateTable("mailbox_settings")
        .set({ loop_wait_days: 5 })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      await profile(trx, org, ANNA);
      await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
      const loop = await only(trx, org);
      expect(loop.due_source).toBe("contact");
      expect(loop.due_at.getTime()).toBe(FRI_1700.getTime());
    });
  });

  test("T7: sent on a Friday with a wait of 2 days: due on Tuesday at 17:00", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA);
      await sentMail(trx, org, { sentAt: FRI, to: [ANNA] });
      expect((await only(trx, org)).due_at.getTime()).toBe(TUE_1700.getTime());
    });
  });

  test("the address is matched without regard to case; a profile of another mailbox or another organization is not used", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      const other = await secondMailbox(trx, { ...org, address: "own@x.test" });
      // A profile of the same address in a second mailbox of the organization, and one in another organization.
      await profile(trx, org, ANNA, { mailboxId: other.mailboxId });
      const stranger = await loopsOrg(trx);
      await profile(trx, stranger, ANNA, { orgId: stranger.ctx.orgId });
      await sentMail(trx, org, { sentAt: WED, to: ["Anna@Example.test"] });
      expect((await only(trx, org)).due_source).toBe("default");
      // The profile of the right mailbox is found whatever the case of the address in the mail.
      await profile(trx, org, ANNA);
      await sentMail(trx, org, { sentAt: WED, to: ["ANNA@example.test"], threadKey: "<other@x.test>" });
      const loops = await analyse(trx, org);
      expect(loops.map((loop) => loop.due_source).sort()).toEqual(["contact", "default"]);
    });
  });

  test("a failed read gives the default wait and a log without the address", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA);
      await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
      const lines: string[] = [];
      const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
      const errorSpy = spyOn(console, "error").mockImplementation(
        (...args: unknown[]) => void lines.push(format(...args))
      );
      try {
        await analyzeSent({ ...depsOf(trx, fakeExtractor()), credentialsKey: "not-a-key" }, org.ctx, org.mailboxId, {
          now: RUN_AT,
          limit: 20,
        });
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
      expect(lines.some((line) => line.includes("contact_wait_failed"))).toBe(true);
      for (const line of lines) expect(line).not.toContain("example.test");
      const loop = (await loopsOf(trx, org))[0];
      expect(loop?.due_source).toBe("default");
      expect(lines.join("")).not.toContain("example.test");
    });
  });

  test("the loop item shows the usual reply days only for a contact wait", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA);
      await profile(trx, org, "tom@example.test", { samples: 4 });
      await sentMail(trx, org, { sentAt: WED, to: [ANNA] });
      await sentMail(trx, org, { sentAt: WED, to: ["tom@example.test"] });
      const loops = await analyse(trx, org);
      const items = await loopItemsOf(trx, org.ctx, loops.map(toLoopRow));
      const byWho = new Map(items.map((item) => [item.counterpart, item]));
      expect(byWho.get(ANNA)).toMatchObject({ dueSource: "contact", usualReplyDays: 1 });
      expect(byWho.get("tom@example.test")).toMatchObject({ dueSource: "default", usualReplyDays: null });
    });
  });
});

describe("the read of the contact wait", () => {
  test("it runs only for a new waiting or delegated loop with no stated date, once, for the counterpart", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const env = {
        mailboxId: org.mailboxId,
        ownAddresses: [],
        timeZone: "Europe/Warsaw",
        waitDays: 3,
        delegates: [],
        now: RUN_AT,
      };
      const write = async (answer: Answer, calls: string[]) => {
        const id = await sentMail(trx, org, { sentAt: WED, to: ["Anna@Example.test", "tom@example.test"] });
        const row = await trx.selectFrom("sent_emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
        const candidate: SentCandidate = {
          id,
          threadKey: row.thread_key,
          messageId: row.message_id,
          referencesIds: [],
          fromAddress: null,
          to: row.to_addresses,
          cc: [],
          subject: row.subject,
          bodyText: row.body_text,
          content: "stored",
          sentAt: row.sent_at,
          listId: null,
          autoSubmitted: null,
          hasCalendar: false,
          actionId: null,
          attempts: 0,
        };
        const extraction: Extraction = {
          expectsReply: answer.expects_reply,
          ask: answer.ask,
          due: answer.due === null ? null : new Date("2026-11-27T16:00:00Z"),
          promise: null,
          promiseDue: null,
          language: "en",
        };
        await writeExtraction(trx, org.ctx, env, candidate, extraction, "v1", async (counterpart) => {
          calls.push(counterpart);
          return null;
        });
      };
      const open: string[] = [];
      await write(ASK, open);
      expect(open).toEqual(["anna@example.test"]);
      const stated: string[] = [];
      await write({ ...ASK, due: { kind: "date", date: "2026-11-27" } }, stated);
      expect(stated).toEqual([]);
      const none: string[] = [];
      await write({ ...ASK, expects_reply: false, ask: null }, none);
      expect(none).toEqual([]);
    });
  });
});

describe("contactWaitFor", () => {
  test("returns the wait and the usual reply days; null for each case that gives none", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await flags(trx, org);
      await profile(trx, org, ANNA, { their: 200 });
      const deps = { db: trx, credentialsKey: LOOPS_KEY };
      // 200 h: 1.5 times is 12.5 days, capped at 7 working days; the usual reply is 8 days.
      expect(await contactWaitFor(deps, org.ctx, org.mailboxId, " ANNA@example.test ")).toEqual({
        waitDays: 7,
        usualReplyDays: 8,
      });
      expect(await contactWaitFor(deps, org.ctx, org.mailboxId, "nobody@example.test")).toBeNull();
      await flags(trx, org, { wait: false });
      expect(await contactWaitFor(deps, org.ctx, org.mailboxId, ANNA)).toBeNull();
    });
  });
});
