// F116 stage 18, review 18 G1: the digest and "Track my sent mail" off lock the loops of a mailbox in one order (by id).
// The old digest locked the waiting loops first and the promised loops second, by due date; `onSentOff` locks by id. With a
// promised loop of LOW id and a waiting loop of HIGH id the two orders cross. The shape, with committed rows:
//   X holds the waiting loop (the high id), as any other command would;
//   A, the digest, starts and asks for its loops. The old code asked for the waiting rows first: it queued behind X;
//   B, the Sent switch off, starts. It locks the promised loop (low id) and queues behind X for the waiting loop;
//   X commits. A is first in the queue, gets the waiting loop, asks for the promised loop, held by B: 40P01.
// With one pass by id, A takes the low loop first, B waits for A, and no cycle exists. App role, table owner and a mix.
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { sentSwitchHooks } from "../../src/composition";
import { queueDigest } from "../../src/modules/channels";
import { NO_TEST_SENDERS, setSentSync } from "../../src/modules/mail";
import { createDb, type Db } from "../../src/platform/db";

import { briefOrg, EIGHT, waitingLoop, type BriefOrg } from "./channels-digest-brief-fixtures";
import { testDb } from "./helpers";
import { FRIDAY } from "./loops-commands-fixtures";
import { insertLoopRow } from "./loops-fixtures";

const app = testDb();
const appB = testDb();
const appX = testDb();
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
  await Promise.all([app.destroy(), appB.destroy(), appX.destroy(), owner.destroy(), ownerB.destroy()]);
});

// The lowest and the highest ids that sort first and last; the rest is random so that every round has its own.
const lowId = () => `00000000-${randomUUID().slice(9)}`;
const highId = () => `ffffffff-${randomUUID().slice(9)}`;
const ROUNDS = 4;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function newOrg(): Promise<BriefOrg> {
  const org = await app.transaction().execute((trx) => briefOrg(trx));
  orgs.push(org.ctx.orgId);
  users.push(org.userId, org.memberId);
  return org;
}

const codeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;

const pairs: [string, Db, Db][] = [
  ["app role", app, appB],
  ["table owner", owner, ownerB],
  ["app role and table owner", app, ownerB],
];

describe.each(pairs)("the digest against the Sent switch off (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} rounds: a promised loop of low id, a waiting loop of high id: both finish, no 40P01`, async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const org = await newOrg();
      const low = lowId();
      const high = highId();
      await app.transaction().execute(async (trx) => {
        await insertLoopRow(trx, org.ctx, org.mailboxId, {
          id: low,
          kind: "promised",
          counterpart: "promise@brief.example.test",
          text: "send the plan",
          due_at: new Date("2026-11-20T10:00:00Z"),
        });
        await waitingLoop(trx, org, { id: high });
      });

      // X holds the waiting loop until both others are queued.
      const release = Promise.withResolvers<undefined>();
      const held = Promise.withResolvers<undefined>();
      const holder = appX.transaction().execute(async (trx) => {
        await trx.selectFrom("open_loops").select("id").where("id", "=", high).forUpdate().execute();
        held.resolve(undefined);
        await release.promise;
      });
      await held.promise;

      const digest = connA
        .transaction()
        .execute(async (trx) => {
          const link = {
            orgId: org.ctx.orgId,
            userId: org.userId,
            role: "owner" as const,
            chatId: org.chatId,
            linkedAt: new Date("2026-11-05T20:00:00Z"),
            locale: "en" as const,
          };
          return queueDigest(trx, link, {
            slot: { key: "2026-11-20T08:00", date: "2026-11-20", time: "08:00" },
            periodStart: new Date("2026-11-19T07:00:00Z"),
            now: new Date(EIGHT),
            timeZone: "Europe/Warsaw",
            testMail: NO_TEST_SENDERS,
            webBaseUrl: undefined,
          });
        })
        .then(
          (value) => ({ ok: value }),
          (error: unknown) => ({ error })
        );
      await sleep(250);
      const sentOff = connB
        .transaction()
        .execute((trx) =>
          setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks)
        )
        .then(
          (value) => ({ ok: value }),
          (error: unknown) => ({ error })
        );
      await sleep(250);
      release.resolve(undefined);
      await holder;
      const results = await Promise.race([
        Promise.all([digest, sentOff]),
        sleep(20_000).then(() => {
          throw new Error("timeout: a lock that never ends");
        }),
      ]);

      const codes = results.map((result) => ("error" in result ? codeOf(result.error) : null));
      expect(codes).toEqual([null, null]);
      // Whichever came first, no copy of the loops is left: the Sent switch closed them and cleared the digest.
      const rows = await app
        .selectFrom("outbox")
        .select(["text", "view"])
        .where("org_id", "=", org.ctx.orgId)
        .where("kind", "=", "digest")
        .execute();
      expect(JSON.stringify(rows)).not.toContain("promise@brief.example.test");
      expect(JSON.stringify(rows)).not.toContain("anna@example.test");
    }
  }, 90_000);
});
