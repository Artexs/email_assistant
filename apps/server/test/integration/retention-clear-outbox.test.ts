import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { deleteOldLinkTokens, clearOutboxTexts } from "../../src/modules/channels";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { ago, before90, over90 } from "./retention-clear-helpers";

// The retention clears for outbox texts and old link tokens. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("clearOutboxTexts", () => {
  const buttons = [{ kind: "url", label: "Open", url: "https://x.test/" }];

  test("clears sent and failed texts, expires old pending and sending rows, keeps at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      async function seed(org: { orgId: string; userId: string; mailboxId: string }) {
        const add = async (status: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
          (
            await trx
              .insertInto("outbox")
              .values({
                org_id: org.orgId,
                user_id: org.userId,
                kind: "sync_ok",
                dedup_key: `key-${randomUUID()}`,
                mailbox_id: org.mailboxId,
                text: "Message text",
                view: JSON.stringify({ subject: "MARKER" }),
                buttons: JSON.stringify(buttons),
                status,
                created_at: createdAt,
                next_attempt_at: createdAt,
                ...extra,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;
        return {
          sentOver: await add("sent", over90, { sent_at: over90 }),
          failedOver: await add("failed", over90, { error_code: "blocked" }),
          failedNoText: await add("failed", over90, { error_code: "bad_view", text: null }),
          pendingOver: await add("pending", over90),
          sendingOver: await add("sending", over90, { locked_at: over90 }),
          pendingAt: await add("pending", before90),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const read = (id: string) =>
        trx
          .selectFrom("outbox")
          .select(["text", "status", "error_code", "locked_at", "buttons", "view"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

      expect(await clearOutboxTexts(trx, { orgId: a.orgId }, { before: before90 })).toBe(5);

      expect(await read(rowsA.sentOver)).toMatchObject({ text: "[removed]", status: "sent", buttons, view: {} });
      expect(await read(rowsA.failedNoText)).toMatchObject({
        text: "[removed]",
        status: "failed",
        error_code: "bad_view",
        view: {},
      });
      expect(await read(rowsA.failedOver)).toMatchObject({
        text: "[removed]",
        status: "failed",
        error_code: "blocked",
      });
      for (const id of [rowsA.pendingOver, rowsA.sendingOver]) {
        expect(await read(id)).toMatchObject({
          text: "[removed]",
          status: "failed",
          error_code: "expired",
          locked_at: null,
          view: {},
        });
      }
      expect(await read(rowsA.pendingAt)).toMatchObject({
        text: "Message text",
        status: "pending",
        view: { subject: "MARKER" },
      });
      for (const id of Object.values(rowsB)) {
        const rowB = await read(id);
        expect(rowB.view).toEqual({ subject: "MARKER" });
        if (id !== rowsB.failedNoText) expect(rowB.text).toBe("Message text");
      }
      const afterFirst = await trx.selectFrom("outbox").selectAll().where("org_id", "=", a.orgId).execute();
      expect(await clearOutboxTexts(trx, { orgId: a.orgId }, { before: before90 })).toBe(0);
      expect(await trx.selectFrom("outbox").selectAll().where("org_id", "=", a.orgId).execute()).toEqual(afterFirst);
    });
  });
});

describe("deleteOldLinkTokens", () => {
  test("deletes tokens used or expired over one day ago; keeps the rest; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const limit = ago(DAY_MS);
      async function seed(org: { orgId: string; userId: string }) {
        const add = async (expiresAt: Date, usedAt: Date | null) => {
          const hash = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
          await trx
            .insertInto("chat_link_tokens")
            .values({
              org_id: org.orgId,
              user_id: org.userId,
              token_hash: hash,
              expires_at: expiresAt,
              used_at: usedAt,
            })
            .execute();
          return hash;
        };
        return {
          usedOld: await add(ago(-DAY_MS), ago(2 * DAY_MS)),
          expiredOld: await add(ago(2 * DAY_MS), null),
          future: await add(ago(-DAY_MS), null),
          usedRecent: await add(ago(-DAY_MS), ago(HOUR_MS)),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const exists = async (hash: string) =>
        (await trx.selectFrom("chat_link_tokens").select("token_hash").where("token_hash", "=", hash).execute())
          .length === 1;

      expect(await deleteOldLinkTokens(trx, { orgId: a.orgId }, { before: limit })).toBe(2);
      expect(await exists(rowsA.usedOld)).toBe(false);
      expect(await exists(rowsA.expiredOld)).toBe(false);
      expect(await exists(rowsA.future)).toBe(true);
      expect(await exists(rowsA.usedRecent)).toBe(true);
      for (const hash of Object.values(rowsB)) expect(await exists(hash)).toBe(true);
      expect(await deleteOldLinkTokens(trx, { orgId: a.orgId }, { before: limit })).toBe(0);
    });
  });
});
