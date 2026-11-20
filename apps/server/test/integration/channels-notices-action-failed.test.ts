import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";

import { at, ended, Org, org, rows, run, sendOrg, setStatus, T, waiting } from "./channels-notices-helpers";
import {
  addMember,
  createOrgWithMailbox,
  insertAction,
  insertTriaged,
  isolateChannels,
  linkChat,
  randomChatId,
  resumeOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorSpy: ReturnType<typeof spyOn>;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("action_failed notices", () => {
  async function failedMove(
    trx: Transaction<DB>,
    o: Org,
    opts: { statusReason?: string; reverse?: boolean; updatedAt?: Date; subject?: string } = {}
  ): Promise<{ emailId: string; actionId: string }> {
    const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
      category: "info",
      createdAt: at(-2 * HOUR_MS),
      subject: opts.subject ?? "Marker subject",
      from: "Ann <ann@firma.test>",
    });
    const original = await insertAction(trx, o.ctx, emailId, {
      type: "move",
      status: opts.reverse === true ? "undone" : "failed",
      payload: { folder: "ai_info" },
    });
    let actionId = original;
    if (opts.reverse === true) {
      actionId = await insertAction(trx, o.ctx, emailId, {
        type: "move",
        status: "failed",
        payload: { folder: "ai_info" },
        reversesActionId: original,
        statusReason: opts.statusReason ?? "hard_error",
        attempts: 3,
      });
    } else {
      await trx
        .updateTable("actions")
        .set({ status_reason: opts.statusReason ?? "hard_error", attempts: 3 })
        .where("id", "=", original)
        .execute();
    }
    if (opts.updatedAt !== undefined) {
      await trx.updateTable("actions").set({ updated_at: opts.updatedAt }).where("id", "=", actionId).execute();
    }
    return { emailId, actionId };
  }

  async function notifiedAt(trx: Transaction<DB>, actionId: string): Promise<Date | null> {
    const row = await trx
      .selectFrom("actions")
      .select("notified_at")
      .where("id", "=", actionId)
      .executeTakeFirstOrThrow();
    return row.notified_at;
  }

  test("a hard-failed move gives the owner one row, marks the action, and a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { emailId, actionId } = await failedMove(trx, o, { updatedAt: at(-MINUTE_MS) });

      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.user_id).toBe(o.ownerId);
      expect(found[0]?.email_id).toBe(emailId);
      expect(found[0]?.dedup_key).toBe(`action_failed:${actionId}`);
      expect(found[0]?.text).toContain("Marker subject");
      expect(found[0]?.text).toContain("Could not move a mail to AI/Info");
      expect(await notifiedAt(trx, actionId)).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(1);
    });
  });

  test("a hard-failed reverse create_draft gives the owner one row with the draft text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "delegation",
        createdAt: at(-2 * HOUR_MS),
        subject: "Marker subject",
        from: "Ann <ann@firma.test>",
      });
      const original = await insertAction(trx, o.ctx, emailId, {
        type: "create_draft",
        status: "applied",
        payload: { kind: "delegation" },
      });
      const reverse = await insertAction(trx, o.ctx, emailId, {
        type: "create_draft",
        status: "failed",
        payload: { kind: "delegation", folder: "Drafts", uid: 4, reason: "sent" },
        reversesActionId: original,
        statusReason: "hard_error",
        attempts: 3,
      });
      await trx
        .updateTable("actions")
        .set({ updated_at: at(-MINUTE_MS) })
        .where("id", "=", reverse)
        .execute();

      await run(trx);

      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Could not remove the draft for a mail");
      expect(found[0]?.text).toContain("The draft stays in Drafts: delete it by hand.");
      expect(await notifiedAt(trx, reverse)).toEqual(T);
    });
  });

  test("an original mail_not_found gives no row and stays unmarked", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { actionId } = await failedMove(trx, o, { statusReason: "mail_not_found", updatedAt: at(-MINUTE_MS) });
      await run(trx);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
      expect(await notifiedAt(trx, actionId)).toBeNull();
    });
  });

  test("a reverse mail_not_found gives a not-found notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { actionId } = await failedMove(trx, o, {
        reverse: true,
        statusReason: "mail_not_found",
        updatedAt: at(-MINUTE_MS),
      });
      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Undo failed: could not move a mail back to INBOX");
      expect(found[0]?.text).toContain("The mail was not found");
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });

  test("a failed action older than 24 h is marked without a row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { actionId } = await failedMove(trx, o, { updatedAt: at(-30 * HOUR_MS) });
      await run(trx);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });

  test("a hard-failed reverse move gives the Undo text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await failedMove(trx, o, { reverse: true, updatedAt: at(-MINUTE_MS) });
      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Undo failed: could not move a mail back to INBOX");
      expect(found[0]?.text).toContain("Tried 3 times");
    });
  });

  test("a failed reverse move of a mail in another folder names that folder", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const { emailId } = await failedMove(trx, o, { reverse: true, updatedAt: at(-MINUTE_MS) });
      await trx
        .updateTable("emails")
        .set({ folder: "Oferty", source_folder: "Oferty" })
        .where("id", "=", emailId)
        .execute();
      await run(trx);
      const found = await rows(trx, o.orgId, "action_failed");
      expect(found).toHaveLength(1);
      expect(found[0]?.text).toContain("Undo failed: could not move a mail back to Oferty");
    });
  });

  test("no owner is linked, only an assistant: the action is marked, no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const created = await createOrgWithMailbox(trx);
      const ctx = { orgId: created.orgId };
      const assistantId = await addMember(trx, created.orgId);
      await linkChat(trx, ctx, assistantId, randomChatId(), at(-HOUR_MS));
      await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
      const o: Org = {
        ctx,
        orgId: created.orgId,
        ownerId: created.userId,
        assistantId,
        mailboxId: created.mailboxId,
      };
      const { actionId } = await failedMove(trx, o, { updatedAt: at(-MINUTE_MS) });

      await run(trx);

      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });

  test("another organization's failed action gives nothing", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const { actionId } = await failedMove(trx, b, { updatedAt: at(-MINUTE_MS) });
      await run(trx);
      expect(await rows(trx, a.orgId, "action_failed")).toHaveLength(0);
      expect(await rows(trx, b.orgId, "action_failed")).toHaveLength(1);
      expect(await notifiedAt(trx, actionId)).toEqual(T);
    });
  });
});

// Approval requests, reminder sets, send results and answered notices.

describe("after a resume (D4)", () => {
  const resumedAt = new Date("2026-11-12T08:00:00Z");

  function later(offsetMs: number): Date {
    return new Date(resumedAt.getTime() + offsetMs);
  }

  // An organization resumed at `resumedAt`; members linked and the mailbox known 10 days before it.
  async function resumedOrg(trx: Transaction<DB>, lastSyncedAt: Date): Promise<Org> {
    const o = await org(trx);
    await resumeOrg(trx, o.orgId, resumedAt);
    await trx
      .updateTable("chat_links")
      .set({ linked_at: later(-10 * DAY_MS) })
      .where("org_id", "=", o.orgId)
      .execute();
    await trx
      .updateTable("mailboxes")
      .set({
        status: "active",
        status_changed_at: later(-10 * DAY_MS),
        created_at: later(-10 * DAY_MS),
        last_synced_at: lastSyncedAt,
      })
      .where("id", "=", o.mailboxId)
      .execute();
    return o;
  }

  async function runAt(trx: Transaction<DB>, now: Date): Promise<void> {
    await detectNotices({
      db: trx,
      now: () => now,
      startedAt: new Date(now.getTime() - HOUR_MS),
      testMail: NO_TEST_SENDERS,
    });
  }

  test("no sync-late row in the first 30 minutes after the resume; one after, unless the sync is fresh", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const stale = await resumedOrg(trx, later(-3 * DAY_MS));
      const fresh = await resumedOrg(trx, later(2 * MINUTE_MS));

      await runAt(trx, later(5 * MINUTE_MS));
      expect(await rows(trx, stale.orgId, "sync_stale")).toHaveLength(0);

      await runAt(trx, later(31 * MINUTE_MS));
      expect(await rows(trx, stale.orgId, "sync_stale")).toHaveLength(1);
      expect(await rows(trx, fresh.orgId, "sync_stale")).toHaveLength(0);
    });
  });

  test("urgent mail of before the resume gets no notice; mail after it does", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await resumedOrg(trx, later(2 * MINUTE_MS));
      const before = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: later(-2 * HOUR_MS),
      });
      const after = await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: later(MINUTE_MS) });

      await runAt(trx, later(3 * MINUTE_MS));

      const found = await rows(trx, o.orgId, "urgent");
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((row) => row.email_id === after)).toBe(true);
      expect(found.some((row) => row.email_id === before)).toBe(false);
    });
  });
});

describe("stored views and locales", () => {
  async function setLocale(trx: Transaction<DB>, userId: string, locale: string | null) {
    await trx.updateTable("users").set({ locale }).where("id", "=", userId).execute();
  }

  test("every kind stores a view and the locale of its member", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      for (const userId of [o.ownerId, o.secondOwnerId, o.assistantId]) await setLocale(trx, userId, "en");
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      const failedMail = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "info",
        createdAt: at(-2 * HOUR_MS),
      });
      const failed = await insertAction(trx, o.ctx, failedMail, {
        type: "move",
        status: "failed",
        payload: { folder: "ai_info" },
      });
      await trx
        .updateTable("actions")
        .set({ status_reason: "hard_error", attempts: 3, updated_at: at(-MINUTE_MS) })
        .where("id", "=", failed)
        .execute();
      await waiting(trx, o);
      await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE_MS),
        providerResult: { sent_copy: "appended" },
      });
      await setStatus(trx, o, "auth_error", at(-HOUR_MS));
      await run(trx);
      await setStatus(trx, o, "active", at(-HOUR_MS));
      await markSynced(trx, o.ctx, o.mailboxId, at(-40 * MINUTE_MS));
      await run(trx);

      const found = await rows(trx, o.orgId);
      const kinds = new Set(found.map((row) => row.kind));
      for (const kind of ["urgent", "action_failed", "auth_error", "sync_stale", "approval", "send_result"]) {
        expect(kinds.has(kind)).toBe(true);
      }
      for (const row of found) {
        expect(Object.keys(row.view as object).length).toBeGreaterThan(0);
        expect(row.locale).toBe("en");
      }
    });
  });

  test("a member without a locale gets Polish rows and Polish text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setLocale(trx, o.ownerId, "en");
      await setLocale(trx, o.assistantId, null);
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });

      await run(trx);

      const found = await rows(trx, o.orgId, "urgent");
      const english = found.find((row) => row.user_id === o.ownerId);
      const polish = found.find((row) => row.user_id === o.assistantId);
      expect(english?.locale).toBe("en");
      expect(polish?.locale).toBe("pl");
      expect(english?.text).toStartWith("🔴 Urgent mail");
      expect(polish?.text).toStartWith("🔴 Pilna wiadomość");
    });
  });

  test("the urgent view holds the AI reason and plain actions, not a rendered text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const p = await waiting(trx, o, { sendStatus: "logged" });
      await trx.updateTable("triage_results").set({ category: "urgent" }).where("email_id", "=", p.emailId).execute();

      await run(trx);

      const view = (await rows(trx, o.orgId, "urgent"))[0]?.view as Record<string, unknown>;
      for (const key of ["ai", "actions", "delegateNames", "stayFolder"]) expect(view).toHaveProperty(key);
      expect(view).not.toHaveProperty("wouldDo");
      expect(view).not.toHaveProperty("aiText");
      const actions = view.actions as Record<string, unknown>[];
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(Object.keys(action).sort()).toEqual(["delegateId", "folder", "kind", "reverse", "status", "type"]);
      }
    });
  });
});
