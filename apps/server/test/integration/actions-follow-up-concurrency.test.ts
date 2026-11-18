// The lock order of a follow-up (the loop first, then the send). A reply closes the loop while the committer
// sends the approved follow-up. Committed rows on several connections; the organizations and users are deleted at the end.
import { afterAll, describe, expect, test } from "bun:test";

import { applySend } from "../../src/modules/actions";
import { closeLoop } from "../../src/modules/loops";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";

import { testDb } from "./helpers";
import { box, claimAll, committerDeps, pair, sleep, withTimeout } from "./loops-committer-fixtures";

const db = testDb();
const orgs: string[] = [];
const users: string[] = [];
afterAll(async () => {
  for (const id of orgs) await db.deleteFrom("organizations").where("id", "=", id).execute();
  for (const id of users) await db.deleteFrom("users").where("id", "=", id).execute();
  await db.destroy();
});

describe("a loop closes (a reply) while the committer sends: 20 loops", () => {
  test("each send ends applied with one mail, or expired / loop_closed with none; no deadlock", async () => {
    const b = await box(db, orgs, users);
    const sender = createFakeMailSender();
    const pairs: Awaited<ReturnType<typeof pair>>[] = [];
    for (let i = 0; i < 20; i += 1) pairs.push(await pair(db, b, i));
    const claimed = await claimAll(db, b);
    expect(claimed.length).toBe(20);
    const d = committerDeps(db, b, sender);
    const results = await withTimeout(
      Promise.all(
        claimed.map(async (action, i) => {
          const p = pairs.find((x) => x.sendId === action.id);
          if (p === undefined) throw new Error("pair");
          const closer = (async () => {
            await sleep(Math.floor(Math.random() * 40));
            await db.transaction().execute(async (trx) => {
              await closeLoop(trx, b.ctx, { loopId: p.loopId, reason: "replied", at: new Date() });
              await sleep(i % 3);
            });
          })();
          const [out] = await Promise.all([applySend(d, b.ctx, action, b.fake), closer]);
          return { out, p };
        })
      ),
      8_000
    );
    let applied = 0;
    for (const { out, p } of results) {
      const r = await db.selectFrom("actions").selectAll().where("id", "=", p.sendId).executeTakeFirstOrThrow();
      const l = await db.selectFrom("open_loops").selectAll().where("id", "=", p.loopId).executeTakeFirstOrThrow();
      expect(l.status).toBe("closed");
      if (r.status === "applied") {
        applied += 1;
        expect(out).toEqual({ kind: "applied" });
        expect(l.follow_ups_sent).toBe(1);
      } else {
        expect(out).toEqual({ kind: "expired", reason: "loop_closed" });
        expect(r).toMatchObject({ status: "expired", status_reason: "loop_closed" });
        expect(l.follow_ups_sent).toBe(0);
      }
    }
    // One mail per applied send, none for an expired one.
    expect(sender.sent.length).toBe(applied);
  }, 10_000);
});
