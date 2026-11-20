import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { insertSenderRule } from "../../src/modules/config";
import { readSenderActivity, type ReadActivityOptions, type SenderActivity } from "../../src/modules/contacts";

import { ago, newOrg, NOW, type Org, type Trx } from "./contacts-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend, seedSenderActivity, type SeededSent } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The characterization of `readSenderActivity` as it is before its SQL is split into readers owned by the mail, triage and
// delegation modules (the plan of that split is in `spec/features/active`): the whole output of the full pass and of both
// scopes, the number of executed statements of each, and the tenant border. The later stages of the plan keep this file
// unchanged: a failure here means that a moved reader changed a value, a row or a statement.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const TEST_SENDER = "ea-test@example.com";
const OWN_ALIAS = "me-alias@example.com";
const TEST_MAIL = { senders: [TEST_SENDER] };
const OPTIONS: ReadActivityOptions = { now: NOW, testMail: TEST_MAIL };

// All the source rows of one world in one organization. `copies` repeats every mail, Sent mail and delegation with a fresh
// Message-ID, one minute later each time: the second copy makes the mail of the other tenant twice as many.
async function seedWorld(trx: Trx, org: Org, copies: number): Promise<void> {
  const { ctx, mailboxId } = org;
  const delegateId = await insertDelegate(trx, ctx, { name: "Boss", email: "boss@example.com" });
  await insertSenderRule(trx, ctx, { mailboxId: null, pattern: "sub.example.com", kind: "vip" });

  for (let copy = 0; copy < copies; copy += 1) {
    const shift = copy * MINUTE_MS;
    // `days` before NOW (and `hours` more), plus the shift of the copy.
    const at = (days: number, hours = 0): Date => new Date(ago(days, hours).getTime() + shift);
    // The time `hours` after a mail.
    const after = (received: Date, hours: number): Date => new Date(received.getTime() + hours * HOUR_MS);
    const seed = (address: string, mails: Parameters<typeof seedSenderActivity>[3]["mails"], sent?: SeededSent[]) =>
      seedSenderActivity(trx, ctx, mailboxId, { address, mails, ...(sent === undefined ? {} : { sent }) });

    // a: 6 mails over 60 days (2 of them in the last 30), each answered by a Sent reply after 2 to 7 hours.
    const aDays = [5, 20, 35, 45, 55, 60];
    const aCategory = ["info", "needs_reply", "info", "needs_reply", "info", "info"] as const;
    const aMessageIds = aDays.map((day) => `<a-${day}-${randomUUID()}@x.test>`);
    await seed(
      "a@example.com",
      [
        ...aDays.map((day, index) => ({
          at: at(day),
          messageId: aMessageIds[index] as string,
          category: aCategory[index] as "info" | "needs_reply",
          // answered: days 5 and 35. flagged: day 20. unseen and older than 7 days: day 55. Newest feedback of day 60: spam.
          ...(day === 5 || day === 35 ? { answered: true } : {}),
          ...(day === 20 ? { flagged: true } : {}),
          ...(day === 55 ? { seen: false } : {}),
          ...(day === 60 ? { feedback: [{ verdict: "wrong" as const, trueCategory: "spam" as const }] } : {}),
        })),
        // 30 days and 1 hour: in the window, outside the 30-day counts.
        { at: at(30, 1) },
        // Exactly 90 days: the window edge is inside.
        { at: at(90) },
        // 91 days: outside the window.
        { at: at(91) },
        // A synthetic Message-ID: test mail.
        { at: at(8), test: true },
      ],
      [
        ...aDays.map((day, index) => ({
          at: after(at(day), index + 2),
          parent: aMessageIds[index] as string,
        })),
        // A system send and an automatic reply to a: neither counts.
        { at: at(3), system: true },
        { at: at(4), autoSubmitted: "auto-replied" },
      ]
    );

    // b: 5 mails that each name one of 5 Sent mails (sent without recipients) in In-Reply-To, 1 to 5 hours after that Sent mail.
    const bDays = [10, 12, 14, 16, 18];
    const bSentIds = bDays.map((day) => `<b-sent-${day}-${randomUUID()}@x.test>`);
    await seedSenderActivity(trx, ctx, mailboxId, {
      sent: bDays.map((day, index) => ({
        at: at(day, index + 1),
        to: [],
        messageId: bSentIds[index] as string,
      })),
    });
    await seed(
      "b@example.com",
      bDays.map((day, index) => ({
        at: at(day),
        inReplyTo: bSentIds[index] as string,
        category: day === 14 ? ("spam" as const) : ("info" as const),
        ...(day === 12 ? { suspicious: true } : {}),
        // The user moved the spam mail back.
        ...(day === 14 ? { feedback: [{ verdict: "wrong" as const, source: "imap_move" as const }] } : {}),
      })),
      // Two Sent mails to b, one in To and one in Cc.
      [
        { at: at(2), to: ["b@example.com"] },
        { at: at(1), to: [], cc: ["B@EXAMPLE.COM"] },
      ]
    );
    // The same sender in another case.
    await seed("B@Example.com", [{ at: at(22) }]);

    // news: 3 mails with a List-Id, one with List-Unsubscribe and Auto-Submitted, one whose headers are cleared.
    await seed("news@example.com", [
      { at: at(2), headers: { listId: "<n.example.com>" } },
      { at: at(3), headers: { listId: "<n.example.com>" } },
      { at: at(4), headers: { listId: "<n.example.com>" } },
      { at: at(5), headers: { listUnsubscribe: "<mailto:u@example.com>", autoSubmitted: "auto-generated" } },
      { at: at(6), headers: { listId: "<n.example.com>", cleared: true } },
    ]);

    // noreply: bulk by name, with no headers.
    await seed("noreply@example.com", [{ at: at(7) }, { at: at(9) }]);

    // boss: an active delegate with 2 delegations in the window (one at the edge) and 1 outside, and one Sent mail.
    const source = await seed("boss@example.com", [], [{ at: at(15), to: ["boss@example.com"] }]);
    expect(source.sentIds).toHaveLength(1);
    for (const created of [at(11), at(90), at(91)]) {
      const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctx, mailboxId, {
        delegateId,
        to: "boss@example.com",
        createdAt: created,
      });
      await insertDelegation(trx, ctx, {
        mailboxId,
        emailId,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        createdAt: created,
      });
    }

    // vip: a sender of a VIP domain rule. Look-alikes of the domain scope.
    await seed("vip@sub.example.com", [{ at: at(13), category: "info" }]);
    await seed("x@example.org", [{ at: at(14) }]);
    await seed("y@notexample.com", [{ at: at(14) }]);

    // Own addresses and test mail get no row: the mailbox address, a Sent alias that also wrote one mail, a test sender.
    await seed(org.address, [{ at: at(16) }]);
    await seed(OWN_ALIAS, [{ at: at(17) }], [{ at: at(17), from: OWN_ALIAS, to: [] }]);
    await seed(TEST_SENDER, [{ at: at(18) }]);
  }
}

const ORG_A_ADDRESS = "me@example.com";

const activityOf = (trx: Trx, org: Org, mailboxId = org.mailboxId, only?: ReadActivityOptions["only"]) =>
  readSenderActivity(trx, org.ctx, mailboxId, { ...OPTIONS, ...(only === undefined ? {} : { only }) });

// Executed statements, counted in `transformResult`: a builder that another builder embeds is not a statement of its own.
async function statementsOf(trx: Trx, org: Org, only?: ReadActivityOptions["only"]): Promise<number> {
  let statements = 0;
  const counted = trx.withPlugin({
    transformQuery: (args) => args.node,
    transformResult: async (args) => {
      statements += 1;
      return args.result;
    },
  });
  await readSenderActivity(counted, org.ctx, org.mailboxId, { ...OPTIONS, ...(only === undefined ? {} : { only }) });
  return statements;
}

async function world(trx: Trx): Promise<Org> {
  const org = await newOrg(trx, { address: ORG_A_ADDRESS });
  await seedWorld(trx, org, 1);
  return org;
}

// The default of every field of `SenderActivity`. A row lists the fields that differ from it.
const row = (over: Partial<SenderActivity> & { address: string }): SenderActivity => ({
  received: 0,
  received30: 0,
  answered: 0,
  answered30: 0,
  flagged: 0,
  flagged30: 0,
  unseen7d: 0,
  movedBack: 0,
  userMailsTo: 0,
  delegationsTo: 0,
  byCategory: {},
  corrections: {},
  correctedToSpam90: 0,
  rescued90: 0,
  suspicious90: 0,
  repliedBySent90: 0,
  bulkSignals: [],
  bulkBase: 0,
  bulkMails: 0,
  medianUserReplyHours: null,
  medianTheirReplyHours: null,
  replySamplesTheirs: 0,
  firstSeenAt: null,
  lastSeenAt: null,
  lastUserMailAt: null,
  relation: "new",
  ...over,
});

// The rows of the full pass, written out from a run of the read before the move and checked by hand against the world above.
// Each field is non-default in at least one row: received, received30, answered, answered30, flagged, flagged30, unseen7d,
// userMailsTo, byCategory, corrections, correctedToSpam90, repliedBySent90, medianUserReplyHours, the three dates and the
// relation `known`: a. movedBack, rescued90, suspicious90, medianTheirReplyHours, replySamplesTheirs: b. delegationsTo and the
// relation `delegate`: boss. bulkSignals, bulkBase, bulkMails and the relation `bulk`: news. The relation `vip`: vip. `new`: x.

const FULL: SenderActivity[] = [
  row({
    address: "a@example.com",
    received: 8,
    received30: 2,
    answered: 2,
    answered30: 1,
    flagged: 1,
    flagged30: 1,
    unseen7d: 1,
    userMailsTo: 6,
    byCategory: { info: 4, needs_reply: 2 },
    corrections: { spam: 1 },
    correctedToSpam90: 1,
    repliedBySent90: 6,
    medianUserReplyHours: 4.5,
    firstSeenAt: new Date("2026-08-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-13T10:00:00.000Z"),
    lastUserMailAt: new Date("2026-11-13T12:00:00.000Z"),
    relation: "known",
  }),
  row({
    address: "b@example.com",
    received: 6,
    received30: 6,
    movedBack: 1,
    userMailsTo: 2,
    byCategory: { info: 4, spam: 1 },
    rescued90: 1,
    suspicious90: 1,
    medianTheirReplyHours: 3,
    replySamplesTheirs: 5,
    firstSeenAt: new Date("2026-10-27T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-08T10:00:00.000Z"),
    lastUserMailAt: new Date("2026-11-17T10:00:00.000Z"),
    relation: "known",
  }),
  row({
    address: "boss@example.com",
    userMailsTo: 1,
    delegationsTo: 2,
    lastUserMailAt: new Date("2026-11-03T10:00:00.000Z"),
    relation: "delegate",
  }),
  row({
    address: "news@example.com",
    received: 5,
    received30: 5,
    bulkSignals: ["list_id", "list_unsubscribe", "auto_submitted"],
    bulkBase: 4,
    bulkMails: 4,
    firstSeenAt: new Date("2026-11-12T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-16T10:00:00.000Z"),
    relation: "bulk",
  }),
  row({
    address: "noreply@example.com",
    received: 2,
    received30: 2,
    bulkSignals: ["noreply"],
    bulkBase: 2,
    bulkMails: 2,
    firstSeenAt: new Date("2026-11-09T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-11T10:00:00.000Z"),
    relation: "bulk",
  }),
  row({
    address: "vip@sub.example.com",
    received: 1,
    received30: 1,
    byCategory: { info: 1 },
    firstSeenAt: new Date("2026-11-05T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-05T10:00:00.000Z"),
    relation: "vip",
  }),
  row({
    address: "x@example.org",
    received: 1,
    received30: 1,
    firstSeenAt: new Date("2026-11-04T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-04T10:00:00.000Z"),
  }),
  row({
    address: "y@notexample.com",
    received: 1,
    received30: 1,
    firstSeenAt: new Date("2026-11-04T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-04T10:00:00.000Z"),
  }),
];

const ADDRESS_A: SenderActivity[] = [
  row({
    address: "a@example.com",
    received: 8,
    received30: 2,
    answered: 2,
    answered30: 1,
    flagged: 1,
    flagged30: 1,
    unseen7d: 1,
    userMailsTo: 6,
    byCategory: { info: 4, needs_reply: 2 },
    corrections: { spam: 1 },
    correctedToSpam90: 1,
    repliedBySent90: 6,
    firstSeenAt: new Date("2026-08-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-13T10:00:00.000Z"),
    lastUserMailAt: new Date("2026-11-13T12:00:00.000Z"),
    relation: "known",
  }),
];

const DOMAIN: SenderActivity[] = [
  row({
    address: "a@example.com",
    received: 8,
    received30: 2,
    answered: 2,
    answered30: 1,
    flagged: 1,
    flagged30: 1,
    unseen7d: 1,
    userMailsTo: 6,
    byCategory: { info: 4, needs_reply: 2 },
    corrections: { spam: 1 },
    correctedToSpam90: 1,
    repliedBySent90: 6,
    firstSeenAt: new Date("2026-08-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-13T10:00:00.000Z"),
    lastUserMailAt: new Date("2026-11-13T12:00:00.000Z"),
    relation: "known",
  }),
  row({
    address: "b@example.com",
    received: 6,
    received30: 6,
    movedBack: 1,
    userMailsTo: 2,
    byCategory: { info: 4, spam: 1 },
    rescued90: 1,
    suspicious90: 1,
    firstSeenAt: new Date("2026-10-27T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-08T10:00:00.000Z"),
    lastUserMailAt: new Date("2026-11-17T10:00:00.000Z"),
    relation: "known",
  }),
  row({
    address: "boss@example.com",
    userMailsTo: 1,
    lastUserMailAt: new Date("2026-11-03T10:00:00.000Z"),
    relation: "delegate",
  }),
  row({
    address: "news@example.com",
    received: 5,
    received30: 5,
    bulkSignals: ["list_id", "list_unsubscribe", "auto_submitted"],
    bulkBase: 4,
    bulkMails: 4,
    firstSeenAt: new Date("2026-11-12T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-16T10:00:00.000Z"),
    relation: "bulk",
  }),
  row({
    address: "noreply@example.com",
    received: 2,
    received30: 2,
    bulkSignals: ["noreply"],
    bulkBase: 2,
    bulkMails: 2,
    firstSeenAt: new Date("2026-11-09T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-11T10:00:00.000Z"),
    relation: "bulk",
  }),
  row({
    address: "vip@sub.example.com",
    received: 1,
    received30: 1,
    byCategory: { info: 1 },
    firstSeenAt: new Date("2026-11-05T10:00:00.000Z"),
    lastSeenAt: new Date("2026-11-05T10:00:00.000Z"),
    relation: "vip",
  }),
];

const STATEMENTS = { full: 12, address: 9, domain: 9 };

// The scopes skip the reply delays and the delegation counts: those fields stay empty.
describe("readSenderActivity, the whole output of today's read", () => {
  test("1 the full pass: every field of every row, sorted by address", async () => {
    await withRollback(db, async (trx) => {
      const org = await world(trx);
      expect(await activityOf(trx, org)).toEqual(FULL);
    });
  });

  test("2 an address scope: the one row, with the delays and the delegations empty", async () => {
    await withRollback(db, async (trx) => {
      const org = await world(trx);
      expect(await activityOf(trx, org, org.mailboxId, { address: "a@example.com" })).toEqual(ADDRESS_A);
    });
  });

  test("3 a domain scope: the domain and its subdomains, never a look-alike", async () => {
    await withRollback(db, async (trx) => {
      const org = await world(trx);
      expect(await activityOf(trx, org, org.mailboxId, { domain: "example.com" })).toEqual(DOMAIN);
    });
  });

  test("4 the number of executed statements of the full pass and of each scope", async () => {
    await withRollback(db, async (trx) => {
      const org = await world(trx);
      expect({
        full: await statementsOf(trx, org),
        address: await statementsOf(trx, org, { address: "a@example.com" }),
        domain: await statementsOf(trx, org, { domain: "example.com" }),
      }).toEqual(STATEMENTS);
    });
  });

  test("5 a second organization with the same addresses and twice the mail never counts", async () => {
    await withRollback(db, async (trx) => {
      const a = await world(trx);
      const b = await newOrg(trx);
      await seedWorld(trx, b, 2);
      expect(await activityOf(trx, a)).toEqual(FULL);
      // The other organization holds the doubled world: its own read sees it, so the empty result below is the border.
      const own = await activityOf(trx, b);
      expect(own.find((item) => item.address === "a@example.com")?.received).toBe(16);
      // Mailbox ids are unique: only the `org_id` filters keep the mailbox of the other organization out.
      expect(await activityOf(trx, a, b.mailboxId)).toEqual([]);
      expect(await activityOf(trx, b, a.mailboxId)).toEqual([]);
    });
  });
});
