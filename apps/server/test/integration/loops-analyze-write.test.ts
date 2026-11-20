import { storedAddressForm } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { analyzeSent, writeExtraction } from "../../src/modules/loops";
import { writeSentSwitch } from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";

import { insertDelegate } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  analysisOf,
  type Answer,
  ASK,
  depsOf,
  fakeExtractor,
  FRI,
  loopsOf,
  loopsOrg,
  RUN_AT,
  sentMail,
  WED,
} from "./loops-analyze-fixtures";
import type { Org } from "./mail-sent-fixtures";

// The call and the write of the Sent analysis (step 2): which loops one answer opens, with which
// recipients and due dates, and what the model can never decide.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const run = (trx: Trx, org: Org, answer: Answer, at = RUN_AT) => {
  const fake = fakeExtractor(answer);
  return analyzeSent(depsOf(trx, fake), org.ctx, org.mailboxId, { now: at, limit: 20 }).then((out) => ({ out, fake }));
};

describe("which loops an answer opens", () => {
  test("T5: expects_reply with no date opens one waiting loop due 3 working days after the mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org, {
        sentAt: FRI,
        to: ["anna@example.test", "tom@example.test"],
        cc: ["kim@example.test"],
        subject: "Offer for next week",
        threadKey: "<t5@x.test>",
        messageId: "<m5@x.test>",
      });
      const { out, fake } = await run(trx, org, ASK);
      expect(out).toMatchObject({ analysed: 1, opened: 1 });
      expect(fake.requests).toHaveLength(1);
      const loops = await loopsOf(trx, org);
      expect(loops).toHaveLength(1);
      const loop = loops[0] as (typeof loops)[number];
      expect(loop).toMatchObject({
        kind: "waiting",
        status: "open",
        sent_email_id: id,
        thread_key: "<t5@x.test>",
        message_id: "<m5@x.test>",
        subject: "Offer for next week",
        to_addresses: ["anna@example.test", "tom@example.test"],
        cc_addresses: ["kim@example.test"],
        counterpart: "anna@example.test",
        delegate_id: null,
        text: "send the numbers",
        language: "en",
        due_source: "default",
      });
      // Friday 2026-11-20 + 3 working days = Wednesday 2026-11-25, 17:00 in Warsaw.
      expect(loop.due_at.toISOString()).toBe("2026-11-25T16:00:00.000Z");
      expect(loop.wait_from_at.toISOString()).toBe(FRI.toISOString());
      expect(await analysisOf(trx, id)).toMatchObject({
        status: "done",
        skip_reason: null,
        expects_reply: true,
        has_promise: false,
        prompt_version: "extractor-v1",
        attempts: 0,
      });
      const audit = await trx
        .selectFrom("audit_log")
        .select(["data", "actor"])
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "loop.opened")
        .execute();
      expect(audit).toEqual([{ actor: "system", data: { loop_id: loop.id, kind: "waiting" } }]);
    });
  });

  test("a stated due date is used and marked stated; the language other becomes en", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { sentAt: WED });
      await run(trx, org, { ...ASK, due: { kind: "date", date: "2026-11-24" }, language: "other" });
      const [loop] = await loopsOf(trx, org);
      expect(loop).toMatchObject({ due_source: "stated", language: "en" });
      expect(loop?.due_at.toISOString()).toBe("2026-11-24T16:00:00.000Z");
    });
  });

  test("T6: a dated promise opens a promised loop next to the waiting loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org, { sentAt: WED, to: ["anna@example.test", "tom@example.test"] });
      await run(trx, org, {
        ...ASK,
        promise: "send the offer",
        promise_due: { kind: "word", word: "friday" },
        language: "pl",
      });
      const loops = await loopsOf(trx, org);
      expect(loops.map((loop) => loop.kind).sort()).toEqual(["promised", "waiting"]);
      const promised = loops.find((loop) => loop.kind === "promised");
      expect(promised).toMatchObject({
        sent_email_id: id,
        text: "send the offer",
        counterpart: "anna@example.test",
        due_source: "stated",
        language: "pl",
      });
      // Friday 2026-11-20, 17:00 in Warsaw.
      expect(promised?.due_at.toISOString()).toBe("2026-11-20T16:00:00.000Z");
      expect(await analysisOf(trx, id)).toMatchObject({ expects_reply: true, has_promise: true });
    });
  });

  test("a promise with no resolved date opens nothing; a promise alone opens only the promised loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const undated = await sentMail(trx, org, { sentAt: WED });
      await run(trx, org, { ...ASK, expects_reply: false, ask: null, promise: "send the offer", promise_due: null });
      expect(await loopsOf(trx, org)).toHaveLength(0);
      expect(await analysisOf(trx, undated)).toMatchObject({ status: "done", has_promise: false });

      const dated = await sentMail(trx, org, { sentAt: WED });
      await run(trx, org, {
        ...ASK,
        expects_reply: false,
        ask: null,
        promise: "send the offer",
        promise_due: { kind: "word", word: "friday" },
      });
      expect((await loopsOf(trx, org)).map((loop) => loop.kind)).toEqual(["promised"]);
      expect(await analysisOf(trx, dated)).toMatchObject({ expects_reply: false, has_promise: true });
    });
  });

  test("an ask with expects_reply false opens no waiting loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      await run(trx, org, { ...ASK, expects_reply: false, ask: "send the numbers" });
      expect(await loopsOf(trx, org)).toHaveLength(0);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "done", expects_reply: false });
    });
  });

  test("a mail that expects nothing is done with no loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      await run(trx, org, { ...ASK, expects_reply: false, ask: null });
      expect(await loopsOf(trx, org)).toHaveLength(0);
      expect((await analysisOf(trx, id))?.status).toBe("done");
    });
  });

  test("a Cc-only mail names the first Cc as the counterpart", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { to: [], cc: ["Kim@Example.test"] });
      await run(trx, org, ASK);
      expect((await loopsOf(trx, org))[0]).toMatchObject({ counterpart: "kim@example.test", to_addresses: [] });
    });
  });
});

describe("a hand forward to a delegate", () => {
  test("T7: the first To of an active delegate opens one delegated loop and no waiting loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: "dana@team.test" });
      const id = await sentMail(trx, org, { to: ["boss@example.test", "dana@team.test"] });
      const { out } = await run(trx, org, ASK);
      expect(out.opened).toBe(1);
      const loops = await loopsOf(trx, org);
      expect(loops).toHaveLength(1);
      expect(loops[0]).toMatchObject({
        kind: "delegated",
        delegate_id: delegateId,
        counterpart: "dana@team.test",
        sent_email_id: id,
        to_addresses: ["boss@example.test", "dana@team.test"],
      });
    });
  });

  test("a delegate address in capital letters in the Sent row still matches", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: "dana@team.test" });
      await sentMail(trx, org, { to: ["Boss@Example.test", "DANA@Team.test"] });
      await run(trx, org, ASK);
      expect((await loopsOf(trx, org))[0]).toMatchObject({
        kind: "delegated",
        delegate_id: delegateId,
        counterpart: "dana@team.test",
      });
    });
  });

  test("04-T2: a delegate stored from İlker@Example.com owns a Sent ask to ilker@example.com", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: storedAddressForm("İlker@Example.com") });
      await sentMail(trx, org, { to: ["boss@example.test", "ilker@example.com"] });
      await run(trx, org, ASK);
      expect((await loopsOf(trx, org))[0]).toMatchObject({
        kind: "delegated",
        delegate_id: delegateId,
        counterpart: "ilker@example.com",
      });
    });
  });

  test("04-T3: the counterpart is the stored form (trim, lower case), never the rule form", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { to: ["Ann@Example.com"] });
      await run(trx, org, ASK);
      await sentMail(trx, org, { to: ["ΝΊΚΟΣ@example.gr"] });
      await run(trx, org, ASK);
      const counterparts = (await loopsOf(trx, org)).map((loop) => loop.counterpart).sort();
      // The rule form of the Greek address ends in σ; the stored form keeps the word-final ς.
      expect(counterparts).toEqual(["ann@example.com", "νίκος@example.gr"]);
    });
  });

  test("an inactive delegate, a delegate in Cc only and a delegate of another organization give a waiting loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const other = await loopsOrg(trx);
      await insertDelegate(trx, org.ctx, { email: "off@team.test", active: false });
      await insertDelegate(trx, org.ctx, { email: "cc@team.test" });
      await insertDelegate(trx, other.ctx, { email: "foreign@team.test" });
      await sentMail(trx, org, { to: ["off@team.test"] });
      await sentMail(trx, org, { to: ["anna@example.test"], cc: ["cc@team.test"] });
      await sentMail(trx, org, { to: ["foreign@team.test"] });
      await run(trx, org, ASK);
      const loops = await loopsOf(trx, org);
      expect(loops.map((loop) => loop.kind)).toEqual(["waiting", "waiting", "waiting"]);
      expect(loops.every((loop) => loop.delegate_id === null)).toBe(true);
    });
  });

  test("a delegated loop and a promise from one mail: one delegated, one promised", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await insertDelegate(trx, org.ctx, { email: "dana@team.test" });
      await sentMail(trx, org, { to: ["dana@team.test"], sentAt: WED });
      await run(trx, org, { ...ASK, promise: "send the offer", promise_due: { kind: "word", word: "friday" } });
      expect((await loopsOf(trx, org)).map((loop) => loop.kind).sort()).toEqual(["delegated", "promised"]);
    });
  });
});

describe("what the model never decides", () => {
  test("an address in the ask empties the ask; the recipients stay those of the Sent row", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { to: ["anna@example.test"], cc: ["kim@example.test"] });
      await run(trx, org, { ...ASK, ask: "write to evil@attacker.test" });
      const [loop] = await loopsOf(trx, org);
      expect(loop).toMatchObject({
        text: null,
        to_addresses: ["anna@example.test"],
        cc_addresses: ["kim@example.test"],
      });
      expect(JSON.stringify(loop)).not.toContain("attacker");
    });
  });

  test("an answer with a recipient, a folder or a command key is a schema failure: no loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      const hostile = { ...ASK, to: ["evil@attacker.test"], folder: "Trash", command: "/approve all" } as Answer;
      const { out } = await run(trx, org, hostile);
      expect(out).toMatchObject({ opened: 0, waiting: 1 });
      expect(await loopsOf(trx, org)).toHaveLength(0);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "pending", attempts: 1 });
    });
  });

  test("the subject loses its line breaks and is cut to 300 characters", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { subject: `Offer\r\nBcc: evil@attacker.test\n${"x".repeat(400)}` });
      await run(trx, org, ASK);
      const [loop] = await loopsOf(trx, org);
      expect(loop?.subject).not.toMatch(/[\r\n]/);
      expect(loop?.subject?.startsWith("Offer Bcc: evil@attacker.test xxx")).toBe(true);
      expect([...(loop?.subject ?? "")]).toHaveLength(300);
    });
  });

  test("an empty subject becomes null", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org, { subject: " \r\n " });
      await run(trx, org, ASK);
      expect((await loopsOf(trx, org))[0]?.subject).toBeNull();
    });
  });
});

describe("the write", () => {
  test("T8: a second run of the same row changes nothing: one analysis row, one loop", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      const fake = fakeExtractor(ASK);
      const deps = depsOf(trx, fake);
      await analyzeSent(deps, org.ctx, org.mailboxId, { now: RUN_AT, limit: 20 });
      // A crash after the commit of the loop but before the next run: the analysis row is gone, the loop stays.
      await trx.deleteFrom("sent_analyses").where("sent_email_id", "=", id).execute();
      const again = await analyzeSent(deps, org.ctx, org.mailboxId, { now: RUN_AT, limit: 20 });
      expect(again.opened).toBe(0);
      expect(fake.requests).toHaveLength(2);
      expect(await loopsOf(trx, org)).toHaveLength(1);
      const rows = await trx.selectFrom("sent_analyses").selectAll().where("org_id", "=", org.ctx.orgId).execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("done");
    });
  });

  test("a finished analysis row is not overwritten by a later write", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      await run(trx, org, { ...ASK, expects_reply: false, ask: null });
      expect(await analysisOf(trx, id)).toMatchObject({ status: "done", expects_reply: false });
      // A second writer (another process) with another answer: the first result stays.
      const row = await trx.selectFrom("sent_emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      const outcome = await writeExtraction(
        trx,
        org.ctx,
        {
          mailboxId: org.mailboxId,
          ownAddresses: [],
          timeZone: "Europe/Warsaw",
          waitDays: 3,
          delegates: [],
          now: RUN_AT,
        },
        {
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
        },
        { expectsReply: true, ask: "x", due: null, promise: null, promiseDue: null, language: "en" },
        "extractor-v1"
      );
      expect(outcome).toEqual({ kind: "exists" });
      expect(await analysisOf(trx, id)).toMatchObject({ status: "done", expects_reply: false });
      expect(await loopsOf(trx, org)).toHaveLength(0);
    });
  });

  test("a closed loop of the same mail is not opened again", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      await run(trx, org, ASK);
      await trx
        .updateTable("open_loops")
        .set({ status: "closed", close_reason: "dropped", closed_at: RUN_AT })
        .where("sent_email_id", "=", id)
        .execute();
      await trx.deleteFrom("sent_analyses").where("sent_email_id", "=", id).execute();
      await run(trx, org, ASK);
      const loops = await loopsOf(trx, org);
      expect(loops).toHaveLength(1);
      expect(loops[0]?.status).toBe("closed");
    });
  });

  test("a loop is never written for a mailbox whose switch is off", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org);
      const fake = fakeExtractor({ ...ASK });
      const deps = depsOf(trx, fake, {
        llm: {
          ...fake.llm,
          // The user turns the switch off while the call runs.
          generate: async (call) => {
            await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
            return fake.llm.generate(call);
          },
        },
      });
      const out = await analyzeSent(deps, org.ctx, org.mailboxId, { now: RUN_AT, limit: 20 });
      expect(out.opened).toBe(0);
      expect(await loopsOf(trx, org)).toHaveLength(0);
      const rows = await trx.selectFrom("sent_analyses").selectAll().where("org_id", "=", org.ctx.orgId).execute();
      expect(rows).toHaveLength(0);
    });
  });
});
