// The open-loops count of the minimal digest equals the count line of a later digest: loops plus the delegations due today, with or
// without the consent of the member, in the first digest of the day too.

import { noticeViewSchemas } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { briefOrg, EIGHT, ready, runDigests, waitingLoop, type BriefOrg } from "./channels-digest-brief-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function seed(trx: Transaction<DB>, org: BriefOrg): Promise<void> {
  await waitingLoop(trx, org);
  await insertLoopRow(trx, org.ctx, org.mailboxId, {
    kind: "promised",
    text: "PROMISE-TEXT",
    counterpart: "promise@example.test",
    due_at: new Date("2026-11-20T10:00:00Z"),
  });
  const delegate = await insertDelegate(trx, org.ctx, { name: "Marta" });
  const row = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
    delegateId: delegate,
    subject: "DELEGATION-SUBJECT",
  });
  await insertDelegation(trx, org.ctx, {
    mailboxId: org.mailboxId,
    emailId: row.emailId,
    delegateId: delegate,
    draftActionId: row.draftId,
    sendActionId: row.sendId,
    status: "sent",
    dueAt: new Date("2026-11-20T10:00:00Z"),
  });
}

const minimalOf = async (trx: Transaction<DB>, orgId: string) => {
  const row = await trx.selectFrom("outbox").select("view").where("org_id", "=", orgId).executeTakeFirstOrThrow();
  return noticeViewSchemas.digest.parse(row.view).minimal;
};

describe("the open loops of the first minimal digest of the day", () => {
  test("1. a member with no consent: loops plus the delegation due today, and no text of a loop in the facts", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx, { consent: false });
      await seed(trx, org);
      await runDigests(trx, EIGHT);
      const minimal = await minimalOf(trx, org.ctx.orgId);
      expect(minimal?.openLoops).toEqual({ waiting: 2, promised: 1 });
      expect(JSON.stringify(minimal)).not.toMatch(/PROMISE-TEXT|promise@example|DELEGATION-SUBJECT|Marta/);
    });
  });

  test("2. a member whose consent covers loops gets the same counts", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await ready(trx);
      await seed(trx, org);
      await runDigests(trx, EIGHT);
      expect((await minimalOf(trx, org.ctx.orgId))?.openLoops).toEqual({ waiting: 2, promised: 1 });
    });
  });
});
