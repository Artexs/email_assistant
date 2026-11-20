import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  clearSentHeaders,
  getSentSummary,
  insertSentEmails,
  listSentHealth,
  listUserAnswers,
  type NewSentEmail,
} from "../../src/modules/mail";
import {
  insertMailbox,
  markSentPass,
  resetSentCursor,
  updateSentCursor,
  writeSentSwitch,
} from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

// `toMatchObject` does not compare the value of a Date: compare the time in ms.
const ms = (value: Date | null | undefined): number | undefined => value?.getTime();

interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

async function secondMailbox(trx: Transaction<DB>, org: Org): Promise<Org> {
  const id = randomUUID();
  await insertMailbox(trx, org.ctx, {
    id,
    address: `box-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  return { ctx: org.ctx, mailboxId: id };
}

let counter = 0;

// One Sent row; the default is a user row in "Sent" with headers only. Returns the row id.
async function sent(trx: Transaction<DB>, org: Org, at: Date, extra: Partial<NewSentEmail> = {}): Promise<string> {
  counter += 1;
  const key = `s${counter}-${randomUUID()}`;
  await insertSentEmails(trx, org.ctx, [
    {
      mailboxId: org.mailboxId,
      dedupKey: key,
      path: "Sent",
      uidValidity: 7,
      uid: counter,
      messageId: `<${key}@x.test>`,
      parentMessageId: null,
      referencesIds: [],
      threadKey: key,
      fromAddress: "me@corp.test",
      toAddresses: ["to@x.test"],
      ccAddresses: [],
      subject: "Re: X",
      sentAt: at,
      internalDate: at,
      origin: "user",
      actionId: null,
      content: "headers_only",
      ...extra,
    },
  ]);
  const row = await trx
    .selectFrom("sent_emails")
    .select("id")
    .where("mailbox_id", "=", org.mailboxId)
    .where("dedup_key", "=", key)
    .executeTakeFirstOrThrow();
  return row.id;
}

// The sender of the incoming mail is the address that the default Sent row goes to (`to@x.test`): an answer goes to the sender.
const incoming = (trx: Transaction<DB>, org: Org, messageId: string | null, from = "to@x.test") =>
  insertTestEmail(trx, org.ctx, org.mailboxId, { message_id_header: messageId, from_address: from });

describe("listUserAnswers", () => {
  test("gives the earliest user reply with its time and row id", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const x = await incoming(trx, a, "<x@a.test>");
      const s1 = await sent(trx, a, ago(2 * HOUR_MS), { parentMessageId: "<x@a.test>" });
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<x@a.test>" });

      const answers = await listUserAnswers(trx, a.ctx, [x]);

      expect(answers.size).toBe(1);
      expect(ms(answers.get(x)?.answeredAt)).toBe(ago(2 * HOUR_MS).getTime());
      expect(answers.get(x)?.sentEmailId).toBe(s1);
    });
  });

  test("breaks a tie of the send time by the row id", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const x = await incoming(trx, a, "<x@a.test>");
      const first = await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<x@a.test>" });
      const second = await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<x@a.test>" });

      expect((await listUserAnswers(trx, a.ctx, [x])).get(x)?.sentEmailId).toBe([first, second].sort()[0]);
    });
  });

  test("a system reply is no answer; a user row with an action id is", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const x = await incoming(trx, a, "<x@a.test>");
      const y = await incoming(trx, a, "<y@a.test>");
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<x@a.test>", origin: "system", actionId: randomUUID() });
      const byHand = await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<y@a.test>", actionId: randomUUID() });

      const answers = await listUserAnswers(trx, a.ctx, [x, y]);

      expect(answers.has(x)).toBe(false);
      expect(answers.get(y)?.sentEmailId).toBe(byHand);
    });
  });

  test("a reply in another mailbox of the organization is no answer; any Sent path counts", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const other = await secondMailbox(trx, a);
      const x = await incoming(trx, a, "<x@a.test>");
      const y = await incoming(trx, a, "<y@a.test>");
      await sent(trx, other, ago(HOUR_MS), { parentMessageId: "<x@a.test>" });
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<y@a.test>", path: "Old" });

      const answers = await listUserAnswers(trx, a.ctx, [x, y]);

      expect(answers.has(x)).toBe(false);
      expect(answers.has(y)).toBe(true);
    });
  });

  test("a Sent mail that keeps the thread headers but goes to someone else (a forward) is no answer; To, Cc and the Reply-To of the mail count", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const forward = await incoming(trx, a, "<fwd@a.test>", "boss@x.test");
      const toSender = await incoming(trx, a, "<to@a.test>", "boss@x.test");
      const ccSender = await incoming(trx, a, "<cc@a.test>", "boss@x.test");
      const viaReplyTo = await incoming(trx, a, "<rt@a.test>", "list@x.test");
      const mixedCase = await incoming(trx, a, "<mc@a.test>", "Boss@X.test");
      await trx
        .insertInto("email_headers")
        .values({
          email_id: viaReplyTo,
          org_id: a.ctx.orgId,
          reply_to: ["owner@x.test"],
          parts_known: true,
          captured_at: NOW,
        })
        .execute();
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<fwd@a.test>", toAddresses: ["colleague@x.test"] });
      await sent(trx, a, ago(HOUR_MS), {
        parentMessageId: "<to@a.test>",
        toAddresses: ["colleague@x.test", "boss@x.test"],
      });
      await sent(trx, a, ago(HOUR_MS), {
        parentMessageId: "<cc@a.test>",
        toAddresses: ["colleague@x.test"],
        ccAddresses: ["boss@x.test"],
      });
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<rt@a.test>", toAddresses: ["owner@x.test"] });
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<mc@a.test>", toAddresses: ["boss@x.test"] });

      const answers = await listUserAnswers(trx, a.ctx, [forward, toSender, ccSender, viaReplyTo, mixedCase]);

      expect(answers.has(forward)).toBe(false);
      expect(answers.has(toSender)).toBe(true);
      expect(answers.has(ccSender)).toBe(true);
      expect(answers.has(viaReplyTo)).toBe(true);
      // The stored sender address is lower case (`from_address_lower`), the stored Sent addresses are lower case: a mixed-case sender matches.
      expect(answers.has(mixedCase)).toBe(true);
    });
  });

  test("an automatic Sent mail (Auto-Submitted other than no) is no answer; `no` and no header are", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const auto = await incoming(trx, a, "<auto@a.test>");
      const withParams = await incoming(trx, a, "<par@a.test>");
      const no = await incoming(trx, a, "<no@a.test>");
      const plain = await incoming(trx, a, "<plain@a.test>");
      const setAuto = async (id: string, value: string) =>
        trx.updateTable("sent_emails").set({ auto_submitted: value }).where("id", "=", id).execute();
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<auto@a.test>" }), "auto-replied");
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<par@a.test>" }), "Auto-Generated; x=1");
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<no@a.test>" }), "no");
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<plain@a.test>" });

      const answers = await listUserAnswers(trx, a.ctx, [auto, withParams, no, plain]);

      expect([...answers.keys()].sort()).toEqual([no, plain].sort());
    });
  });

  test("G2. `No` (upper case) and `no; param` in the stored Auto-Submitted count as an answer; `AUTO-REPLIED` and `auto-replied; x=1` do not", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const upper = await incoming(trx, a, "<up@a.test>");
      const withParam = await incoming(trx, a, "<wp@a.test>");
      const autoUpper = await incoming(trx, a, "<au@a.test>");
      const autoParam = await incoming(trx, a, "<ap@a.test>");
      const setAuto = async (id: string, value: string) =>
        trx.updateTable("sent_emails").set({ auto_submitted: value }).where("id", "=", id).execute();
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<up@a.test>" }), "No");
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<wp@a.test>" }), "no; param=1");
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<au@a.test>" }), "AUTO-REPLIED");
      await setAuto(await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<ap@a.test>" }), "auto-replied; x=1");

      const answers = await listUserAnswers(trx, a.ctx, [upper, withParam, autoUpper, autoParam]);

      expect([...answers.keys()].sort()).toEqual([upper, withParam].sort());
    });
  });

  test("N-a. settledOnly: a pending row with no Auto-Submitted is no answer yet; a read row, a headers-only row and a pending row with a stored `no` are", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const pending = await incoming(trx, a, "<pe@a.test>");
      const stored = await incoming(trx, a, "<st@a.test>");
      const headersOnly = await incoming(trx, a, "<ho@a.test>");
      const pendingNo = await incoming(trx, a, "<pn@a.test>");
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<pe@a.test>", content: "pending" });
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<st@a.test>", content: "pending" }).then((id) =>
        trx.updateTable("sent_emails").set({ content: "stored" }).where("id", "=", id).execute()
      );
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<ho@a.test>", content: "headers_only" });
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<pn@a.test>", content: "pending" }).then((id) =>
        trx.updateTable("sent_emails").set({ auto_submitted: "no" }).where("id", "=", id).execute()
      );
      const all = [pending, stored, headersOnly, pendingNo];

      const settled = await listUserAnswers(trx, a.ctx, all, { settledOnly: true });
      const plain = await listUserAnswers(trx, a.ctx, all);

      expect([...settled.keys()].sort()).toEqual([stored, headersOnly, pendingNo].sort());
      // Without the option the pending row counts as before (the pass before a send reads its header itself).
      expect([...plain.keys()].sort()).toEqual(all.sort());
    });
  });

  test("a mail without a reply or without a Message-ID is absent; no ids give an empty map", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const y = await incoming(trx, a, "<y@a.test>");
      const z = await incoming(trx, a, null);
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: null });

      expect((await listUserAnswers(trx, a.ctx, [y, z])).size).toBe(0);
      expect((await listUserAnswers(trx, a.ctx, [])).size).toBe(0);
    });
  });

  test("handles 600 ids in chunks: the one answered at position 550 is found", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const ids: string[] = [];
      for (let n = 0; n < 600; n += 1) ids.push(await incoming(trx, a, `<m${n}@a.test>`));
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<m550@a.test>" });

      const answers = await listUserAnswers(trx, a.ctx, ids);

      expect([...answers.keys()]).toEqual([ids[550] as string]);
    });
  });

  test("still answers after the headers were cleared", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const x = await incoming(trx, a, "<x@a.test>");
      await sent(trx, a, ago(100 * DAY_MS), { parentMessageId: "<x@a.test>" });

      expect(await clearSentHeaders(trx, a.ctx, { before: ago(90 * DAY_MS) })).toBe(1);

      expect((await listUserAnswers(trx, a.ctx, [x])).has(x)).toBe(true);
    });
  });

  test("organization B sees no answer for the ids of organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const x = await incoming(trx, a, "<x@a.test>");
      await sent(trx, a, ago(HOUR_MS), { parentMessageId: "<x@a.test>" });

      expect((await listUserAnswers(trx, b.ctx, [x])).size).toBe(0);
    });
  });
});

async function pathOn(trx: Transaction<DB>, org: Org, path: string): Promise<void> {
  await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: ago(DAY_MS) });
  await resetSentCursor(trx, org.ctx, org.mailboxId, { path });
}

describe("getSentSummary", () => {
  test("counts user mail of the current path since the date and gives the newest of any age", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      await pathOn(trx, a, "Sent");
      await sent(trx, a, ago(DAY_MS));
      await sent(trx, a, ago(40 * DAY_MS));
      await sent(trx, a, ago(HOUR_MS), { origin: "system", actionId: randomUUID() });
      await sent(trx, a, ago(HOUR_MS), { path: "Old" });

      const summary = await getSentSummary(trx, a.ctx, a.mailboxId, { since: ago(30 * DAY_MS) });

      expect(summary.userCount).toBe(1);
      expect(ms(summary.newestUserAt)).toBe(ago(DAY_MS).getTime());
    });
  });

  test("gives the newest date also when every mail is older than the window", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      await pathOn(trx, a, "Sent");
      await sent(trx, a, ago(40 * DAY_MS));

      const summary = await getSentSummary(trx, a.ctx, a.mailboxId, { since: ago(30 * DAY_MS) });

      expect(summary.userCount).toBe(0);
      expect(ms(summary.newestUserAt)).toBe(ago(40 * DAY_MS).getTime());
    });
  });

  test("no rows, no state or no path give zero and null", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const since = ago(30 * DAY_MS);
      const none = { userCount: 0, newestUserAt: null };
      expect(await getSentSummary(trx, a.ctx, a.mailboxId, { since })).toEqual(none);
      await sent(trx, a, ago(HOUR_MS));
      expect(await getSentSummary(trx, a.ctx, a.mailboxId, { since })).toEqual(none);
      await writeSentSwitch(trx, a.ctx, a.mailboxId, { enabled: true, at: ago(DAY_MS) });
      expect(await getSentSummary(trx, a.ctx, a.mailboxId, { since })).toEqual(none);
      await resetSentCursor(trx, a.ctx, a.mailboxId, { path: "Sent" });
      expect((await getSentSummary(trx, a.ctx, a.mailboxId, { since })).userCount).toBe(1);
    });
  });

  test("organization B gets nothing for the mailbox of organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await pathOn(trx, a, "Sent");
      await sent(trx, a, ago(HOUR_MS));

      expect(await getSentSummary(trx, b.ctx, a.mailboxId, { since: ago(30 * DAY_MS) })).toEqual({
        userCount: 0,
        newestUserAt: null,
      });
    });
  });
});

describe("listSentHealth", () => {
  test("lists the mailboxes with the switch on and a first pass, with the newest user date and the error code", async () => {
    await withRollback(db, async (trx) => {
      const m1 = await newOrg(trx);
      const m2 = await secondMailbox(trx, m1);
      const m3 = await secondMailbox(trx, m1);
      for (const m of [m1, m2]) await pathOn(trx, m, "Sent");
      await writeSentSwitch(trx, m3.ctx, m3.mailboxId, { enabled: false });
      await updateSentCursor(
        trx,
        m1.ctx,
        m1.mailboxId,
        { uidValidity: 7, lastUid: 3 },
        { firstPassAt: ago(2 * DAY_MS) }
      );
      await markSentPass(trx, m1.ctx, m1.mailboxId, { at: ago(HOUR_MS), errorCode: "folder_missing" });
      await sent(trx, m1, ago(DAY_MS));
      await sent(trx, m1, ago(3 * DAY_MS));
      await sent(trx, m1, ago(HOUR_MS), { origin: "system", actionId: randomUUID() });

      const rows = await listSentHealth(trx, m1.ctx);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.mailboxId).toBe(m1.mailboxId);
      expect(ms(rows[0]?.firstPassAt)).toBe(ago(2 * DAY_MS).getTime());
      expect(ms(rows[0]?.lastPassAt)).toBe(ago(HOUR_MS).getTime());
      expect(ms(rows[0]?.newestUserAt)).toBe(ago(DAY_MS).getTime());
      expect(rows[0]?.lastErrorCode).toBe("folder_missing");
    });
  });

  test("gives null dates for a mailbox without a pass time or user mail; organization B sees none", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await pathOn(trx, a, "Sent");
      await updateSentCursor(trx, a.ctx, a.mailboxId, { uidValidity: 7, lastUid: 0 }, { firstPassAt: ago(DAY_MS) });

      const rows = await listSentHealth(trx, a.ctx);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.mailboxId).toBe(a.mailboxId);
      expect(ms(rows[0]?.firstPassAt)).toBe(ago(DAY_MS).getTime());
      expect(rows[0]?.lastPassAt).toBeNull();
      expect(rows[0]?.newestUserAt).toBeNull();
      expect(rows[0]?.lastErrorCode).toBeNull();
      expect(await listSentHealth(trx, b.ctx)).toEqual([]);
    });
  });
});

describe("the readers and the log", () => {
  test("write no console line and no mail data: canary subject, body and address", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      await pathOn(trx, a, "Sent");
      await updateSentCursor(trx, a.ctx, a.mailboxId, { uidValidity: 7, lastUid: 1 }, { firstPassAt: ago(DAY_MS) });
      const x = await incoming(trx, a, "<x@a.test>", "canary-to@x.test");
      const id = await sent(trx, a, ago(HOUR_MS), {
        parentMessageId: "<x@a.test>",
        subject: "CanarySubject",
        toAddresses: ["canary-to@x.test"],
        fromAddress: "canary-from@x.test",
      });
      await trx
        .updateTable("sent_emails")
        .set({ content: "stored", body_text: "CanaryBody" })
        .where("id", "=", id)
        .execute();
      const lines: string[] = [];
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        spyOn(console, method).mockImplementation((...args: unknown[]) => {
          lines.push(format(...args));
        })
      );
      try {
        const answers = await listUserAnswers(trx, a.ctx, [x]);
        const summary = await getSentSummary(trx, a.ctx, a.mailboxId, { since: ago(30 * DAY_MS) });
        const health = await listSentHealth(trx, a.ctx);
        expect(answers.has(x)).toBe(true);
        expect(summary.userCount).toBe(1);
        expect(health).toHaveLength(1);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }

      expect(lines).toEqual([]);
    });
  });
});
