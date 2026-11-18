// The close rules race on real connections. Committed rows; the organizations and users are deleted at the
// end. Each case runs on the app role and on the table owner (the owner has no row level security, so only the org filters
// of the queries keep the organizations apart). The rules: a loop closes once (one audit row, one expiry of its send),
// `auto_reply_at` is set once, a mail counts only after `wait_from_at`, a loop never closes twice.
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { applySend } from "../../src/modules/actions";
import { lockLoop, matchReplies, onSentOff, restartLoop } from "../../src/modules/loops";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { createDb, type Db, type DB } from "../../src/platform/db";

import { testDb } from "./helpers";
import { box, claimAll, committerDeps, pair, sleep, withTimeout } from "./loops-committer-fixtures";
import { insertLoopActionPair, insertSentRow } from "./loops-fixtures";
import { after, closedAudit, loopRow, loopsOrg, reply, waiting } from "./loops-match-fixtures";
import type { Org } from "./mail-sent-fixtures";

const app = testDb();
const appB = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (ownerUrl === undefined)
  throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the table owner cases");
const owner = createDb(ownerUrl);
const ownerB = createDb(ownerUrl);

const orgs: string[] = [];
const users: string[] = [];
afterAll(async () => {
  for (const id of orgs) await app.deleteFrom("organizations").where("id", "=", id).execute();
  for (const id of users) await app.deleteFrom("users").where("id", "=", id).execute();
  await Promise.all([app.destroy(), appB.destroy(), owner.destroy(), ownerB.destroy()]);
});

const ROUNDS = 12;
const pairs: [string, Db, Db][] = [
  ["app role", app, appB],
  ["table owner", owner, ownerB],
  ["app role and table owner", app, ownerB],
];

async function newOrg(): Promise<Org> {
  const org = await app.transaction().execute((trx) => loopsOrg(trx));
  orgs.push(org.ctx.orgId);
  users.push(org.userId);
  return org;
}

const jitter = () => sleep(Math.floor(Math.random() * 6));
const run = Math.random().toString(36).slice(2, 8);

interface Round {
  loopId: string;
  mailId: string;
  sendId: string;
  sentId: string;
}

// A loop with one reply in its thread, one waiting follow-up send and a Sent row for the restart. Unique subject.
async function seedRound(org: Org, i: number, opts: { reply?: "real" | "auto" } = {}): Promise<Round> {
  return app.transaction().execute(async (trx: Transaction<DB>) => {
    const subject = `S-${run}-${i}`;
    const loop = await waiting(trx, org, { subject });
    const sentId = await insertSentRow(trx, org.ctx, org.mailboxId, { subject });
    const mailId = await reply(trx, org, {
      threadKey: loop.threadKey,
      subject: `Re: ${subject}`,
      at: after(3),
      ...(opts.reply === "auto" ? { autoSubmitted: "auto-replied" } : {}),
    });
    const { sendId } = await insertLoopActionPair(trx, org.ctx, loop.id, {
      draftStatus: "ready",
      sendStatus: "awaiting_approval",
      createdAt: after(2),
    });
    return { loopId: loop.id, mailId, sendId, sentId };
  });
}

describe.each(pairs)("two matchReplies at once on one loop (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} loops: one close, one audit row, one expiry of the send, one mail stored`, async () => {
    const org = await newOrg();
    const noise = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const r = await seedRound(org, i);
      // The same thread key in another organization: it must stay out of the match, also with no row level security.
      await app.transaction().execute(async (trx) => {
        const row = await loopRow(trx, r.loopId);
        await waiting(trx, noise, { thread_key: row.thread_key, subject: `S-${run}-${i}` });
        // Older than the real reply: without the org filter this mail would be the first match.
        await reply(trx, noise, { threadKey: row.thread_key, subject: `Re: S-${run}-${i}`, at: after(1) });
      });
      const t1 = after(5);
      const t2 = after(6);
      const [a, b] = await withTimeout(
        Promise.all([
          matchReplies({ db: connA }, org.ctx, org.mailboxId, { now: t1 }),
          jitter().then(() => matchReplies({ db: connB }, org.ctx, org.mailboxId, { now: t2 })),
        ]),
        8_000
      );
      expect(a.replied + b.replied).toBe(1);
      const row = await loopRow(app, r.loopId);
      expect(row).toMatchObject({ status: "closed", close_reason: "replied", closed_by_email_id: r.mailId });
      expect([t1.getTime(), t2.getTime()]).toContain(row.closed_at?.getTime() ?? 0);
      expect(await closedAudit(app, org.ctx.orgId, r.loopId)).toHaveLength(1);
      const send = await app
        .selectFrom("actions")
        .select("status")
        .where("id", "=", r.sendId)
        .executeTakeFirstOrThrow();
      expect(send.status).toBe("expired");
      const expired = await app
        .selectFrom("audit_log")
        .select("id")
        .where("action_id", "=", r.sendId)
        .where("event", "=", "action.expired")
        .execute();
      expect(expired).toHaveLength(1);
    }
    const open = await app
      .selectFrom("open_loops")
      .select("id")
      .where("org_id", "=", noise.ctx.orgId)
      .where("status", "=", "open")
      .execute();
    expect(open).toHaveLength(ROUNDS);
  }, 30_000);
});

describe.each(pairs)("auto_reply_at is set once (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} loops: two runs at once and a later run: one value, the first one written`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const r = await seedRound(org, i, { reply: "auto" });
      const t1 = after(5);
      const t2 = after(6);
      const [a, b] = await withTimeout(
        Promise.all([
          matchReplies({ db: connA }, org.ctx, org.mailboxId, { now: t1 }),
          jitter().then(() => matchReplies({ db: connB }, org.ctx, org.mailboxId, { now: t2 })),
        ]),
        8_000
      );
      expect(a.autoMarked + b.autoMarked).toBe(1);
      const first = (await loopRow(app, r.loopId)).auto_reply_at;
      expect([t1.getTime(), t2.getTime()]).toContain(first?.getTime() ?? 0);
      await matchReplies({ db: connA }, org.ctx, org.mailboxId, { now: after(7) });
      const row = await loopRow(app, r.loopId);
      expect(row.auto_reply_at?.getTime()).toBe(first?.getTime());
      // An automatic mail never closes.
      expect(row.status).toBe("open");
    }
  }, 30_000);
});

describe.each(pairs)("a reply against a restart of the wait (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} loops: a loop is closed or restarted, never both; a closing mail is newer than wait_from_at`, async () => {
    const org = await newOrg();
    let closed = 0;
    let restarted = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const r = await seedRound(org, i);
      const waitFrom = after(4);
      const [out, ok] = await withTimeout(
        Promise.all([
          matchReplies({ db: connA }, org.ctx, org.mailboxId, { now: after(5) }),
          jitter().then(() =>
            connB.transaction().execute(async (trx) => {
              await lockLoop(trx, org.ctx, r.loopId);
              return restartLoop(trx, org.ctx, {
                loopId: r.loopId,
                sentEmailId: r.sentId,
                messageId: "<next@own.test>",
                referencesIds: [],
                waitFrom,
                dueAt: after(8),
              });
            })
          ),
        ]),
        8_000
      );
      const row = await loopRow(app, r.loopId);
      if (ok) {
        // The restart won: the reply is older than the new wait; it does not count.
        restarted += 1;
        expect(out.replied).toBe(0);
        expect(row.status).toBe("open");
        expect(row.wait_from_at.getTime()).toBe(waitFrom.getTime());
      } else {
        closed += 1;
        expect(out.replied).toBe(1);
        expect(row.status).toBe("closed");
        expect(row.wait_from_at.getTime()).toBeLessThan(after(3).getTime());
      }
    }
    expect(closed + restarted).toBe(ROUNDS);
  }, 30_000);
});

describe.each(pairs)("a reply against the switch off of the Sent tracking (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} loops: one close and one audit row for each loop, whichever wins`, async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const org = await newOrg();
      const r = await seedRound(org, i);
      await withTimeout(
        Promise.all([
          matchReplies({ db: connA }, org.ctx, org.mailboxId, { now: after(5) }),
          jitter().then(() =>
            connB.transaction().execute((trx) => onSentOff(trx, org.ctx, { mailboxId: org.mailboxId, at: after(6) }))
          ),
        ]),
        8_000
      );
      const row = await loopRow(app, r.loopId);
      expect(row.status).toBe("closed");
      expect(["replied", "sent_off"]).toContain(row.close_reason ?? "");
      expect(await closedAudit(app, org.ctx.orgId, r.loopId)).toHaveLength(1);
      const send = await app
        .selectFrom("actions")
        .select("status")
        .where("id", "=", r.sendId)
        .executeTakeFirstOrThrow();
      expect(send.status).toBe("expired");
    }
  }, 30_000);
});

describe.each(pairs)("a reply against the committer that sends the approved follow-up (%s)", (_name, connA) => {
  test("20 loops with a reply: every send expires `loop_closed`, no mail goes out, every loop closes, no deadlock", async () => {
    const b = await box(app, orgs, users);
    const sender = createFakeMailSender();
    const rows: Awaited<ReturnType<typeof pair>>[] = [];
    for (let i = 0; i < 20; i += 1) rows.push(await pair(app, b, i));
    // Every loop gets a reply from its recipient, in its thread.
    for (const p of rows) {
      await app.transaction().execute(async (trx) => {
        const loop = await loopRow(trx, p.loopId);
        await reply(
          trx,
          { ctx: b.ctx, mailboxId: b.mailboxId, userId: b.userId, provider: b.fake },
          {
            from: loop.to_addresses[0] ?? null,
            threadKey: loop.thread_key,
            at: after(1),
            subject: "x",
          }
        );
      });
    }
    const claimed = await claimAll(app, b);
    expect(claimed.length).toBe(20);
    const d = committerDeps(app, b, sender);
    const outs = await withTimeout(
      Promise.all([
        ...claimed.map(async (action) => {
          await sleep(Math.floor(Math.random() * 20));
          return { action, out: await applySend(d, b.ctx, action, b.fake) };
        }),
        ...[0, 1, 2].map(async (k) => {
          // The real clock: the claim of a send is fresh by it, and `expireSend` leaves a fresh claim alone.
          await sleep(k * 7);
          await matchReplies({ db: connA }, b.ctx, b.mailboxId, { now: new Date() });
          return null;
        }),
      ]),
      12_000
    );
    // Every reply is in before the claim, so `isOpen` is false for each send: none is applied and no mail goes out.
    for (const item of outs) {
      if (item === null) continue;
      const r = await app.selectFrom("actions").selectAll().where("id", "=", item.action.id).executeTakeFirstOrThrow();
      expect(item.out).toEqual({ kind: "expired", reason: "loop_closed" });
      expect(r).toMatchObject({ status: "expired", status_reason: "loop_closed" });
    }
    // A last run closes what no run reached before the sends finished.
    await matchReplies({ db: connA }, b.ctx, b.mailboxId, { now: new Date() });
    for (const p of rows) expect((await loopRow(app, p.loopId)).status).toBe("closed");
    expect(sender.sent).toHaveLength(0);
  }, 30_000);
});
