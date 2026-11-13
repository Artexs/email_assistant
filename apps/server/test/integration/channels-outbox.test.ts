import { randomUUID } from "node:crypto";

import { NoticeViewError, renderSyncOkNotice } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  cancelPendingOutbox,
  cancelPendingOutboxOfOrg,
  claimDueOutbox,
  failOutbox,
  insertOutbox,
  listSentStaleEpisodes,
  markOutboxSent,
  queueNotice,
  releaseOutbox,
  type OutboxKind,
} from "../../src/modules/channels";
import { findOutboxByDedup } from "../../src/modules/channels/repo";
import { insertMailbox } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertTestEmail,
  isolateChannels,
  renderedOf,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");
const staleBefore = new Date(T.getTime() - 5 * 60_000);

function minutesFromT(minutes: number): Date {
  return new Date(T.getTime() + minutes * 60_000);
}

let counter = 0;

// A due `sync_ok` row by default; `kind` and its required columns come from the overrides.
function rowFor(
  userId: string,
  overrides: Partial<Parameters<typeof insertOutbox>[2]> & { mailboxId: string }
): Parameters<typeof insertOutbox>[2] {
  counter += 1;
  return {
    userId,
    kind: "sync_ok" as OutboxKind,
    dedupKey: `test:${counter}`,
    view: {},
    locale: "en",
    createdAt: minutesFromT(-60 + counter),
    nextAttemptAt: minutesFromT(-1),
    ...overrides,
  };
}

async function state(trx: Transaction<DB> | typeof db, id: string) {
  return trx
    .selectFrom("outbox")
    .select(["status", "attempts", "next_attempt_at", "locked_at", "sent_at", "external_message_id", "error_code"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function setState(trx: Transaction<DB>, id: string, status: string, lockedAt: Date | null) {
  await trx.updateTable("outbox").set({ status, locked_at: lockedAt }).where("id", "=", id).execute();
}

async function tenant(trx: Transaction<DB>) {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  return { ctx: { orgId: created.orgId } as TenantContext, ...created };
}

async function insert(
  trx: Transaction<DB>,
  t: { ctx: TenantContext; userId: string; mailboxId: string },
  overrides: Partial<Parameters<typeof insertOutbox>[2]> = {}
): Promise<string> {
  const id = await insertOutbox(trx, t.ctx, rowFor(t.userId, { mailboxId: t.mailboxId, ...overrides }));
  if (!id) throw new Error("insert returned null");
  return id;
}

function opts(t: { orgId: string }, overrides: Partial<{ limit: number }> = {}) {
  return { now: T, limit: 10, staleBefore, orgIds: [t.orgId], ...overrides };
}

describe("insertOutbox", () => {
  test("dedups per member and key", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const other = await addMember(trx, t.orgId);
      const row = rowFor(t.userId, { mailboxId: t.mailboxId, dedupKey: "same" });
      const id = await insertOutbox(trx, t.ctx, row);
      expect(id).toBeString();
      expect(await insertOutbox(trx, t.ctx, row)).toBeNull();
      expect(await insertOutbox(trx, t.ctx, { ...row, userId: other })).toBeString();
      const saved = await state(trx, id as string);
      expect(saved.status).toBe("pending");
      expect(saved.attempts).toBe(0);
      expect(saved.next_attempt_at).toEqual(row.nextAttemptAt);
    });
  });

  test("kind action_failed inserts with an email id and fails without", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const emailId = await insertTestEmail(trx, t.ctx, t.mailboxId);
      const id = await insertOutbox(
        trx,
        t.ctx,
        rowFor(t.userId, { mailboxId: t.mailboxId, kind: "action_failed", emailId })
      );
      expect(id).toBeString();
      const error = await insertOutbox(
        trx,
        t.ctx,
        rowFor(t.userId, { mailboxId: t.mailboxId, kind: "action_failed" })
      ).catch((caught: unknown) => caught);
      expect((error as { code?: string }).code).toBe("23514");
    });
  });

  test.each(["approval", "approval_set", "send_result", "delegation_answered"] as const)(
    "kind %s inserts with an email id and fails without",
    async (kind) => {
      await withRollback(db, async (trx) => {
        const t = await tenant(trx);
        const emailId = await insertTestEmail(trx, t.ctx, t.mailboxId);
        const id = await insertOutbox(trx, t.ctx, rowFor(t.userId, { mailboxId: t.mailboxId, kind, emailId }));
        expect(id).toBeString();
        const error = await insertOutbox(trx, t.ctx, rowFor(t.userId, { mailboxId: t.mailboxId, kind })).catch(
          (caught: unknown) => caught
        );
        expect((error as { code?: string }).code).toBe("23514");
      });
    }
  );
});

describe("outbox view columns (F088)", () => {
  test("insertOutbox stores view and locale; the claim returns them with channel and detail", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t, { view: { a: 1 }, locale: "pl" });
      const claimed = await claimDueOutbox(trx, opts(t));
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe(id);
      expect(claimed[0]?.view).toEqual({ a: 1 });
      expect(claimed[0]?.channel).toBe("telegram");
      expect(claimed[0]?.detail).toBe("full");
      expect(claimed[0]?.locale).toBe("pl");
      expect(claimed[0]?.text).toBeNull();
    });
  });

  test("insertOutbox without view and locale stores {} and en", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t);
      const row = await trx
        .selectFrom("outbox")
        .select(["view", "locale"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.view).toEqual({});
      expect(row.locale).toBe("en");
    });
  });

  test("markOutboxSent writes the sent text and buttons", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t);
      const claimed = await claimDueOutbox(trx, opts(t));
      const message = { text: "sent text", buttons: [[{ text: "OK", data: "ok" }]] };
      expect(await markOutboxSent(trx, t.ctx, id, claimed[0]?.lockedAt as Date, { messageId: 5, at: T, message })).toBe(
        true
      );
      const row = await trx
        .selectFrom("outbox")
        .select(["text", "buttons"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.text).toBe("sent text");
      expect(row.buttons).toEqual(message.buttons);
    });
  });

  test("findOutboxByDedup returns locale, channel, detail and a null text", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t, { dedupKey: "find:1", locale: "pl" });
      const found = await findOutboxByDedup(trx, t.ctx, t.userId, "find:1");
      expect(found).toMatchObject({ id, channel: "telegram", detail: "full", locale: "pl" });
      expect(found?.text).toBeNull();
      await trx.updateTable("outbox").set({ text: "sent text" }).where("id", "=", id).execute();
      expect((await findOutboxByDedup(trx, t.ctx, t.userId, "find:1"))?.text).toBe("sent text");
    });
  });
});

describe("claimDueOutbox", () => {
  test("claims due rows oldest first, parsed, locked with the now token; skips future rows; honors the limit", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const second = await insert(trx, t, { createdAt: minutesFromT(-20) });
      const first = await insert(trx, t, { createdAt: minutesFromT(-30) });
      const future = await insert(trx, t, { nextAttemptAt: minutesFromT(1) });

      const claimed = await claimDueOutbox(trx, opts(t));
      expect(claimed.map((r) => r.id)).toEqual([first, second]);
      for (const row of claimed) {
        expect(row.wasStale).toBe(false);
        expect(row.lockedAt).toEqual(T);
        expect(row.kind).toBe("sync_ok");
        expect(row.buttons).toEqual([]);
        expect(row.orgId).toBe(t.orgId);
        expect(row.attempts).toBe(0);
        expect(row.digestId).toBeNull();
        expect((await state(trx, row.id)).status).toBe("sending");
        expect((await state(trx, row.id)).locked_at).toEqual(T);
      }
      expect((await state(trx, future)).status).toBe("pending");

      await setState(trx, first, "pending", null);
      await setState(trx, second, "pending", null);
      expect(await claimDueOutbox(trx, opts(t, { limit: 1 }))).toHaveLength(1);
      expect(await claimDueOutbox(trx, { ...opts(t), orgIds: [] })).toEqual([]);
    });
  });

  test("takes back a stale sending row and leaves a fresh one", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const stale = await insert(trx, t, { createdAt: minutesFromT(-30) });
      const fresh = await insert(trx, t, { createdAt: minutesFromT(-20) });
      await setState(trx, stale, "sending", minutesFromT(-6));
      await setState(trx, fresh, "sending", minutesFromT(-1));

      const claimed = await claimDueOutbox(trx, opts(t));
      expect(claimed.map((r) => r.id)).toEqual([stale]);
      expect(claimed[0]?.wasStale).toBe(true);
      expect((await state(trx, stale)).locked_at).toEqual(T);
      expect((await state(trx, fresh)).locked_at).toEqual(minutesFromT(-1));
    });
  });
});

describe("status changes after a claim", () => {
  test("markOutboxSent needs the claim token and works once", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t);
      const [claimed] = await claimDueOutbox(trx, opts(t));
      const at = minutesFromT(1);

      expect(
        await markOutboxSent(trx, t.ctx, id, minutesFromT(-3), {
          messageId: 77,
          at,
          message: { text: "t", buttons: [] },
        })
      ).toBe(false);
      expect(
        await markOutboxSent(trx, t.ctx, id, claimed?.lockedAt as Date, {
          messageId: 77,
          at,
          message: { text: "t", buttons: [] },
        })
      ).toBe(true);
      const saved = await state(trx, id);
      expect(saved.status).toBe("sent");
      expect(saved.sent_at).toEqual(at);
      expect(Number(saved.external_message_id)).toBe(77);
      expect(saved.locked_at).toBeNull();
      expect(
        await markOutboxSent(trx, t.ctx, id, claimed?.lockedAt as Date, {
          messageId: 77,
          at,
          message: { text: "t", buttons: [] },
        })
      ).toBe(false);
    });
  });

  test("releaseOutbox counts an attempt only on request", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t);
      await claimDueOutbox(trx, opts(t));
      const next = minutesFromT(5);

      expect(await releaseOutbox(trx, t.ctx, id, minutesFromT(-3), { nextAttemptAt: next, countAttempt: true })).toBe(
        false
      );
      expect(await releaseOutbox(trx, t.ctx, id, T, { nextAttemptAt: next, countAttempt: true })).toBe(true);
      let saved = await state(trx, id);
      expect(saved.status).toBe("pending");
      expect(saved.attempts).toBe(1);
      expect(saved.next_attempt_at).toEqual(next);
      expect(saved.locked_at).toBeNull();

      await claimDueOutbox(trx, { ...opts(t), now: next, staleBefore: T });
      expect(await releaseOutbox(trx, t.ctx, id, next, { nextAttemptAt: minutesFromT(9), countAttempt: false })).toBe(
        true
      );
      saved = await state(trx, id);
      expect(saved.status).toBe("pending");
      expect(saved.attempts).toBe(1);
    });
  });

  test("failOutbox sets the code", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await insert(trx, t);
      await claimDueOutbox(trx, opts(t));

      expect(await failOutbox(trx, t.ctx, id, minutesFromT(-3), "blocked")).toBe(false);
      expect(await failOutbox(trx, t.ctx, id, T, "blocked")).toBe(true);
      const saved = await state(trx, id);
      expect(saved.status).toBe("failed");
      expect(saved.error_code).toBe("blocked");
      expect(saved.locked_at).toBeNull();
    });
  });
});

describe("cancelPendingOutbox", () => {
  test("cancels the pending rows of the kind and mailbox only", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const otherUser = await addMember(trx, t.orgId);
      const other = await createOrgWithMailbox(trx);
      const otherBox = { ctx: { orgId: other.orgId }, userId: other.userId, mailboxId: other.mailboxId };
      const kind = { kind: "auth_error" as const };
      const p1 = await insert(trx, t, { ...kind });
      const p2 = await insert(trx, t, { ...kind, userId: otherUser });
      const keep = await insert(trx, t, { ...kind, dedupKey: "auth_error:keep" });
      const sending = await insert(trx, t, { ...kind });
      await setState(trx, sending, "sending", T);
      const otherKind = await insert(trx, t, { kind: "sync_stale" });
      const elsewhere = await insert(trx, otherBox, { ...kind });
      const secondBoxId = randomUUID();
      await insertMailbox(trx, t.ctx, {
        id: secondBoxId,
        address: `box2-${secondBoxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      const sameOrgOtherBox = await insert(trx, { ...t, mailboxId: secondBoxId }, { ...kind });

      const count = await cancelPendingOutbox(trx, t.ctx, {
        kind: "auth_error",
        mailboxId: t.mailboxId,
        exceptDedupKey: "auth_error:keep",
      });
      expect(count).toBe(2);
      for (const id of [p1, p2]) {
        const saved = await state(trx, id);
        expect(saved.status).toBe("failed");
        expect(saved.error_code).toBe("outdated");
      }
      for (const id of [keep, otherKind, elsewhere, sameOrgOtherBox])
        expect((await state(trx, id)).status).toBe("pending");
      expect((await state(trx, sending)).status).toBe("sending");
    });
  });
});

describe("cancelPendingOutboxOfOrg", () => {
  test("cancels the pending rows of the organization except approvals", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const other = await createOrgWithMailbox(trx);
      const otherBox = { ctx: { orgId: other.orgId }, userId: other.userId, mailboxId: other.mailboxId };
      const emailId = await insertTestEmail(trx, t.ctx, t.mailboxId);
      const urgent = await insert(trx, t, { kind: "urgent", emailId });
      const approval = await insert(trx, t, { kind: "approval", emailId });
      const approvalSet = await insert(trx, t, { kind: "approval_set", emailId });
      const sending = await insert(trx, t, { kind: "sync_ok" });
      await setState(trx, sending, "sending", T);
      const sent = await insert(trx, t, { kind: "sync_ok" });
      await setState(trx, sent, "sending", T);
      await markOutboxSent(trx, t.ctx, sent, T, { messageId: 1, at: T, message: { text: "t", buttons: [] } });
      const otherEmail = await insertTestEmail(trx, otherBox.ctx, other.mailboxId);
      const elsewhere = await insert(trx, otherBox, { kind: "urgent", emailId: otherEmail });

      expect(await cancelPendingOutboxOfOrg(trx, t.ctx)).toBe(1);

      const cancelled = await state(trx, urgent);
      expect(cancelled.status).toBe("failed");
      expect(cancelled.error_code).toBe("outdated");
      expect((await state(trx, approval)).status).toBe("pending");
      expect((await state(trx, approvalSet)).status).toBe("pending");
      expect((await state(trx, sending)).status).toBe("sending");
      expect((await state(trx, sent)).status).toBe("sent");
      expect((await state(trx, elsewhere)).status).toBe("pending");
    });
  });
});

describe("listSentStaleEpisodes", () => {
  test("lists a sent stale notice until the sync_ok notice exists", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const staleKey = `sync_stale:${t.mailboxId}:1730000000000`;
      const id = await insert(trx, t, { kind: "sync_stale", dedupKey: staleKey });
      await insert(trx, t, { kind: "sync_stale", dedupKey: `sync_stale:${t.mailboxId}:1740000000000` });
      expect(await listSentStaleEpisodes(trx, t.ctx, t.mailboxId)).toEqual([]);

      await setState(trx, id, "sending", T);
      await markOutboxSent(trx, t.ctx, id, T, { messageId: 1, at: T, message: { text: "t", buttons: [] } });
      expect(await listSentStaleEpisodes(trx, t.ctx, t.mailboxId)).toEqual([
        { userId: t.userId, episode: "1730000000000" },
      ]);

      await insert(trx, t, { kind: "sync_ok", dedupKey: `sync_ok:${t.mailboxId}:1730000000000` });
      expect(await listSentStaleEpisodes(trx, t.ctx, t.mailboxId)).toEqual([]);
    });
  });
});

describe("tenant guard", () => {
  test("another org's context changes and lists nothing", async () => {
    await withRollback(db, async (trx) => {
      const a = await tenant(trx);
      const b = await createOrgWithMailbox(trx);
      const foreign: TenantContext = { orgId: b.orgId };
      const staleKey = `sync_stale:${a.mailboxId}:1730000000000`;
      const sent = await insert(trx, a, { kind: "sync_stale", dedupKey: staleKey });
      const pending = await insert(trx, a, { kind: "auth_error" });
      await setState(trx, sent, "sending", T);
      await markOutboxSent(trx, a.ctx, sent, T, { messageId: 1, at: T, message: { text: "t", buttons: [] } });
      const flight = await insert(trx, a);
      await setState(trx, flight, "sending", T);

      expect(
        await markOutboxSent(trx, foreign, flight, T, { messageId: 2, at: T, message: { text: "t", buttons: [] } })
      ).toBe(false);
      expect(await releaseOutbox(trx, foreign, flight, T, { nextAttemptAt: minutesFromT(5), countAttempt: true })).toBe(
        false
      );
      expect(await failOutbox(trx, foreign, flight, T, "blocked")).toBe(false);
      expect((await state(trx, flight)).status).toBe("sending");
      expect(await cancelPendingOutbox(trx, foreign, { kind: "auth_error", mailboxId: a.mailboxId })).toBe(0);
      expect((await state(trx, pending)).status).toBe("pending");
      expect(await listSentStaleEpisodes(trx, foreign, a.mailboxId)).toEqual([]);
    });
  });
});

describe("claimDueOutbox with two connections", () => {
  test("claims disjoint rows (FOR UPDATE SKIP LOCKED)", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx: TenantContext = { orgId: created.orgId };
    try {
      const t = { ctx, userId: created.userId, mailboxId: created.mailboxId };
      const inserted = await db.transaction().execute(async (trx) => {
        const list: string[] = [];
        for (let n = 0; n < 4; n += 1) list.push(await insert(trx, t));
        return list;
      });

      let first: string[] = [];
      let second: string[] = [];
      await db.transaction().execute(async (trx1) => {
        first = (await claimDueOutbox(trx1, { now: T, limit: 2, staleBefore, orgIds: [created.orgId] })).map(
          (r) => r.id
        );
        second = (await claimDueOutbox(db, { now: T, limit: 10, staleBefore, orgIds: [created.orgId] })).map(
          (r) => r.id
        );
      });

      expect(first).toHaveLength(2);
      expect(second).toHaveLength(2);
      expect([...first, ...second].sort()).toEqual([...inserted].sort());
      for (const id of inserted) expect((await state(db, id)).status).toBe("sending");
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});

describe("queueNotice", () => {
  const syncOk = (address: string) => ({
    address,
    lastSyncedAt: new Date("2026-11-06T09:30:00.123Z"),
    now: T,
    timeZone: "Europe/Warsaw",
  });

  async function rowOf(trx: Transaction<DB>, userId: string, dedupKey: string) {
    return trx
      .selectFrom("outbox")
      .select(["kind", "view", "channel", "detail", "locale", "text", "buttons"])
      .where("user_id", "=", userId)
      .where("dedup_key", "=", dedupKey)
      .execute();
  }

  test("stores the view and the locale, and no text until the send", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const input = syncOk("box@example.test");
      const id = await queueNotice(trx, t.ctx, {
        userId: t.userId,
        locale: "pl",
        kind: "sync_ok",
        view: input,
        dedupKey: "queue:1",
        mailboxId: t.mailboxId,
        now: T,
      });
      expect(id).toBeString();
      const rows = await rowOf(trx, t.userId, "queue:1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.locale).toBe("pl");
      expect(rows[0]?.view).toMatchObject({ lastSyncedAt: "2026-11-06T09:30:00.123Z" });
      expect(rows[0]?.text).toBeNull();
      expect(rows[0]?.buttons).toEqual([]);
      expect(rows[0] && renderedOf(rows[0]).text).toBe(renderSyncOkNotice(input).text);
    });
  });

  test("refuses a view that its schema or renderer rejects, and stores no row", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const base = { userId: t.userId, locale: "en" as const, now: T };
      const tooLong = queueNotice(trx, t.ctx, {
        ...base,
        kind: "digest",
        view: { text: "x".repeat(4097), buttons: [] },
        dedupKey: "queue:long",
      });
      await expect(tooLong).rejects.toBeInstanceOf(NoticeViewError);
      expect(await rowOf(trx, t.userId, "queue:long")).toHaveLength(0);

      // A button with an empty text fails the view schema (outButtonsSchema).
      const badButtons = queueNotice(trx, t.ctx, {
        ...base,
        kind: "digest",
        view: { text: "hello", buttons: [[{ text: "", data: "ok" }]] },
        dedupKey: "queue:buttons",
      });
      await expect(badButtons).rejects.toBeInstanceOf(NoticeViewError);
      expect(await rowOf(trx, t.userId, "queue:buttons")).toHaveLength(0);

      // The check render throws on an e-mail id that is not a UUID.
      const badId = queueNotice(trx, t.ctx, {
        ...base,
        kind: "urgent",
        view: {
          emailId: "not-a-uuid",
          from: null,
          subject: null,
          ai: { reasonCode: "deadline", reason: null },
          receivedAt: T,
          synthetic: false,
          folderTag: null,
          actions: [],
          delegateNames: {},
          stayFolder: "INBOX",
          now: T,
          timeZone: "Europe/Warsaw",
        },
        dedupKey: "queue:badid",
      });
      await expect(badId).rejects.toBeInstanceOf(NoticeViewError);
      expect(await rowOf(trx, t.userId, "queue:badid")).toHaveLength(0);
    });
  });

  test("returns null for the second call of one event", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const call = () =>
        queueNotice(trx, t.ctx, {
          userId: t.userId,
          locale: "en",
          kind: "sync_ok",
          view: syncOk("box@example.test"),
          dedupKey: "queue:twice",
          mailboxId: t.mailboxId,
          now: T,
        });
      expect(await call()).toBeString();
      expect(await call()).toBeNull();
      expect(await rowOf(trx, t.userId, "queue:twice")).toHaveLength(1);
    });
  });

  test("makes a lone surrogate and a NUL safe for jsonb", async () => {
    await withRollback(db, async (trx) => {
      const t = await tenant(trx);
      const id = await queueNotice(trx, t.ctx, {
        userId: t.userId,
        locale: "en",
        kind: "sync_ok",
        view: syncOk("a\ud800\u0000b@example.test"),
        dedupKey: "queue:bad-chars",
        mailboxId: t.mailboxId,
        now: T,
      });
      expect(id).toBeString();
      const rows = await rowOf(trx, t.userId, "queue:bad-chars");
      expect(rows[0]?.view).toMatchObject({ address: "a� b@example.test" });
    });
  });
});
