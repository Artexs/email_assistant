// The follow-up card, the consent gate, the result and failure notices, the held notice, the card edit of a closed
// loop and the 48 hour expiry. Every test runs in a transaction that is rolled back. The races are in `follow-up-cards-races.test.ts`.
import { format } from "node:util";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { createExpiryJob, noDelegationHooks } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { detectNotices, loopConsentOf } from "../../src/modules/channels";
import { listClosedFollowUpCards } from "../../src/modules/channels/card-edits-repo";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { CURRENT_CONSENT, consentRow, insertFollowUp, OLD_CONSENT, unlinkRow } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-20T10:00:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);

// The notice code logs and warns about rows it skips; these tests read the output.
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    warnings.push(format(...args));
  });
  warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(format(...args));
  });
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

interface World {
  ctx: TenantContext;
  orgId: string;
  mailboxId: string;
  owner: string; // consent covers loop data
  owner2: string; // consent covers loop data
  oldOwner: string; // an old consent
  noConsentOwner: string; // linked by the CLI: no consent row
  member: string; // an assistant
}

// Four owners and an assistant, each with a chat. Loop data may go to `owner` and `owner2` only.
async function world(trx: Transaction<DB>): Promise<World> {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-HOUR_MS) })
    .where("id", "=", created.mailboxId)
    .execute();
  const owner2 = await addMember(trx, created.orgId, "owner");
  const oldOwner = await addMember(trx, created.orgId, "owner");
  const noConsentOwner = await addMember(trx, created.orgId, "owner");
  const member = await addMember(trx, created.orgId, "assistant");
  for (const user of [created.userId, owner2, oldOwner, noConsentOwner, member]) {
    await linkChat(trx, ctx, user, randomChatId(), at(-2 * HOUR_MS));
  }
  await consentRow(trx, created.orgId, created.userId, CURRENT_CONSENT, at(-HOUR_MS));
  await consentRow(trx, created.orgId, owner2, CURRENT_CONSENT, at(-HOUR_MS));
  await consentRow(trx, created.orgId, oldOwner, OLD_CONSENT, at(-HOUR_MS));
  await consentRow(trx, created.orgId, member, CURRENT_CONSENT, at(-HOUR_MS));
  await setOrgFeature(trx, ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: T });
  return {
    ctx,
    orgId: created.orgId,
    mailboxId: created.mailboxId,
    owner: created.userId,
    owner2,
    oldOwner,
    noConsentOwner,
    member,
  };
}

// `null`: no panel base URL (no link on any line).
async function run(trx: Transaction<DB>, webBaseUrl: string | null = "https://panel.example.test"): Promise<void> {
  await detectNotices({
    db: trx,
    now: () => T,
    startedAt: at(-HOUR_MS),
    testMail: NO_TEST_SENDERS,
    ...(webBaseUrl === null ? {} : { webBaseUrl }),
  });
}

async function outbox(trx: Transaction<DB>, orgId: string, kind?: string) {
  let query = trx
    .selectFrom("outbox")
    .select([
      "id",
      "user_id",
      "kind",
      "dedup_key",
      "text",
      "buttons",
      "view",
      "locale",
      "status",
      "email_id",
      "loop_id",
      "channel",
      "detail",
    ])
    .where("org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  return (await query.execute()).map((row) => ({ ...row, ...renderedOf(row) }));
}

const users = (rows: { user_id: string }[]) => rows.map((row) => row.user_id).sort();

describe("T4 the approval card of a follow-up and the consent gate", () => {
  test("one card per owner whose consent covers loop data; the others get one fixed line, a member nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        to: ["anna@example.test"],
        cc: ["jan@example.test", "ewa@example.test"],
        subject: "Offer Q1",
      });
      await run(trx);

      const cards = await outbox(trx, w.orgId, "approval");
      expect(users(cards)).toEqual([w.owner, w.owner2].sort());
      for (const card of cards) {
        expect(card.loop_id).toBe(f.loopId);
        expect(card.email_id).toBeNull();
        expect(card.dedup_key).toBe(`approval:${f.sendId}`);
        expect(card.text).toContain("📝 Follow-up\nTo: anna@example.test\nCc: jan@example.test, ewa@example.test");
        expect(card.text).toContain("Follow-up 1 of 2");
        expect(card.text).toContain(`Open in panel: https://panel.example.test/approvals?id=${f.sendId}`);
        expect(card.buttons.flat().map((button) => button.data)).toEqual([`ap:${f.sendId}`, `ar:${f.sendId}`]);
      }

      // The owner with an old consent and the owner with no consent row get the same one line: no recipient, no subject, no text.
      const lines = await outbox(trx, w.orgId, "loop_consent");
      expect(users(lines)).toEqual([w.oldOwner, w.noConsentOwner].sort());
      for (const line of lines) {
        expect(line.text).toBe(
          "A follow-up waits for your approval in the panel.\nOpen in panel: https://panel.example.test/approvals"
        );
        expect(line.view).toEqual({ about: "approval", panelUrl: "https://panel.example.test/approvals" });
        expect(line.loop_id).toBeNull();
        expect(line.email_id).toBeNull();
        expect(line.dedup_key).toMatch(/^loop_consent:approval:2026-11-20$/);
      }
      // No notice of any kind went to the member, and no outbox row holds the recipient for a withheld owner.
      expect((await outbox(trx, w.orgId)).filter((row) => row.user_id === w.member)).toEqual([]);
      for (const user of [w.oldOwner, w.noConsentOwner]) {
        const own = (await outbox(trx, w.orgId)).filter((row) => row.user_id === user);
        expect(JSON.stringify(own)).not.toContain("anna@example.test");
        expect(JSON.stringify(own)).not.toContain("Offer Q1");
      }
      // The send is marked: a second run queues nothing.
      const before = (await outbox(trx, w.orgId)).length;
      await run(trx);
      expect((await outbox(trx, w.orgId)).length).toBe(before);
    });
  });

  test("ten follow-ups in a day give an uncovered owner one line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      for (let i = 0; i < 10; i += 1) await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect((await outbox(trx, w.orgId, "loop_consent")).filter((row) => row.user_id === w.oldOwner)).toHaveLength(1);
      expect((await outbox(trx, w.orgId, "approval")).filter((row) => row.user_id === w.owner)).toHaveLength(10);
    });
  });

  test("the line has no panel link when the panel page is off or the base URL is unset", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx, null);
      for (const line of await outbox(trx, w.orgId, "loop_consent")) {
        expect(line.text).toBe("A follow-up waits for your approval in the panel.");
        expect(line.view).toEqual({ about: "approval" });
      }
    });
  });

  test("a withdrawn consent: a consent older than the last unlink does not count, a newer one does", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await unlinkRow(trx, w.orgId, w.owner2, at(-30 * MINUTE_MS)); // owner2 unlinked after the consent at -1 h
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect(users(await outbox(trx, w.orgId, "approval"))).toEqual([w.owner]);
      expect(users(await outbox(trx, w.orgId, "loop_consent"))).toEqual(
        [w.oldOwner, w.noConsentOwner, w.owner2].sort()
      );
    });
  });

  test("a follow-up whose recipients cannot fit a card: no card, the panel keeps it, the next detector still runs", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const long = Array.from({ length: 10 }, (_, i) => `${"x".repeat(240)}${i}@example.test`);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { to: long.slice(0, 5), cc: long.slice(5) });
      // A later detector of the same organization (an expired send result) still gets its row.
      const ended = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "expired",
        notifiedAt: at(-HOUR_MS),
      });
      await trx.updateTable("actions").set({ status_reason: "timeout" }).where("id", "=", ended.sendId).execute();
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toEqual(
        // The long one gives no card; the ended one was notified already.
        []
      );
      const left = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(left.notified_at).toBeNull();
      expect(await outbox(trx, w.orgId, "send_result")).not.toHaveLength(0);
    });
  });

  test("a draft that names another loop than its send gets no card: the owner never sees text that the loop did not make", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      const other = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { sendStatus: "rejected" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ ...f.draftPayload, loop_id: other.loopId }) })
        .where(
          "id",
          "=",
          (
            await trx
              .selectFrom("actions")
              .select("depends_on_action_id")
              .where("id", "=", f.sendId)
              .executeTakeFirstOrThrow()
          ).depends_on_action_id ?? ""
        )
        .execute();
      await run(trx);
      expect(
        (await outbox(trx, w.orgId, "approval")).filter((row) => row.dedup_key === `approval:${f.sendId}`)
      ).toEqual([]);
      const row = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(row.notified_at).toBeNull();
    });
  });

  test("a mail send keeps going to every owner: the gate is for loop data only", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const { insertDraftAndSend } = await import("./fixtures");
      const mail = await insertDraftAndSend(trx, w.ctx, w.mailboxId, { createdAt: at(-HOUR_MS) });
      await run(trx);
      const cards = await outbox(trx, w.orgId, "approval");
      expect(users(cards)).toEqual([w.owner, w.owner2, w.oldOwner, w.noConsentOwner].sort());
      expect(cards.every((card) => card.email_id === mail.emailId && card.loop_id === null)).toBe(true);
      expect(await outbox(trx, w.orgId, "loop_consent")).toEqual([]);
    });
  });
});

describe("loopConsentOf: the one choke point of the gate", () => {
  test("border: the current version covers, the version before does not, a garbage or future version does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const ids = [w.owner, w.oldOwner, w.noConsentOwner, w.member];
      expect([...(await loopConsentOf(trx, w.ctx, ids))].sort()).toEqual([w.owner, w.member].sort());
      expect(await loopConsentOf(trx, w.ctx, [])).toEqual(new Set());
      const other = await addMember(trx, w.orgId, "owner");
      for (const version of ["garbage", "", "2026-11-15.", "2026-11-15.x", "20261115", "2026-11-14"]) {
        await consentRow(trx, w.orgId, other, version, at(-10 * MINUTE_MS));
        expect((await loopConsentOf(trx, w.ctx, [other])).has(other)).toBe(false);
      }
      await consentRow(trx, w.orgId, other, "2026-11-16", at(-5 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [other])).has(other)).toBe(true);
    });
  });

  test("border: a consent row at the exact time of the unlink row does not count; one millisecond later does", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const user = await addMember(trx, w.orgId, "owner");
      await consentRow(trx, w.orgId, user, CURRENT_CONSENT, at(-10 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(true);
      await unlinkRow(trx, w.orgId, user, at(-10 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(false);
      await consentRow(trx, w.orgId, user, CURRENT_CONSENT, at(-10 * MINUTE_MS + 1));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(true);
      // A later unlink withdraws it again; an unlink of another user does not.
      await unlinkRow(trx, w.orgId, w.owner, at(-5 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(true);
      await unlinkRow(trx, w.orgId, user, at(-5 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [user])).has(user)).toBe(false);
    });
  });

  test("only a chat.unlinked row withdraws: another audit event with the same user id, newer than the consent, does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      for (const event of [auditEvents.orgMemberAdded, auditEvents.chatLinked, auditEvents.webTelegramConsent]) {
        await recordAudit(
          trx,
          { orgId: w.orgId },
          { event, actor: "cli", data: { user_id: w.owner, role: "owner" }, at: at(-5 * MINUTE_MS) }
        );
      }
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(true);
      await unlinkRow(trx, w.orgId, w.owner, at(-4 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(false);
    });
  });

  test("an unlink row of another organization withdraws nothing here", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const other = await createOrgWithMailbox(trx);
      await unlinkRow(trx, other.orgId, w.owner, at(-1 * MINUTE_MS));
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(true);
      expect((await loopConsentOf(trx, { orgId: other.orgId }, [w.owner])).has(w.owner)).toBe(false);
    });
  });

  test("a real unlink (the service) withdraws the consent", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const { unlinkUser } = await import("../../src/modules/channels");
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(true);
      expect(await unlinkUser(trx, w.ctx, w.owner, at(0), { actor: w.owner })).toBe(1);
      expect((await loopConsentOf(trx, w.ctx, [w.owner])).has(w.owner)).toBe(false);
    });
  });
});

describe("T8 the result notice of a follow-up", () => {
  test("an applied follow-up: one send_result per covered owner with the loop id and no mail id; the others get the result line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        to: ["anna@example.test"],
        sendStatus: "applied",
        notifiedAt: at(-HOUR_MS),
        send: { provider_result: JSON.stringify({ sent_copy: "appended" }), applied_at: at(-10 * MINUTE_MS) },
      });
      await run(trx);
      const results = await outbox(trx, w.orgId, "send_result");
      expect(users(results)).toEqual([w.owner, w.owner2].sort());
      for (const row of results) {
        expect(row.loop_id).toBe(f.loopId);
        expect(row.email_id).toBeNull();
        expect(row.text).toBe("✅ Follow-up sent to anna@example.test");
        expect(row.buttons).toEqual([]);
      }
      const lines = await outbox(trx, w.orgId, "loop_consent");
      expect(users(lines)).toEqual([w.oldOwner, w.noConsentOwner].sort());
      expect(lines.every((line) => line.text?.startsWith("A follow-up has a new result in the panel."))).toBe(true);
      expect(JSON.stringify(lines)).not.toContain("anna@example.test");
      const mark = await trx
        .selectFrom("actions")
        .select("result_notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(mark.result_notified_at).not.toBeNull();
    });
  });

  test("a rejected and an expired follow-up end in a result too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const rejected = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "rejected",
        notifiedAt: at(-HOUR_MS),
      });
      const expired = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "expired",
        notifiedAt: at(-HOUR_MS),
      });
      await trx.updateTable("actions").set({ status_reason: "loop_closed" }).where("id", "=", expired.sendId).execute();
      await run(trx);
      const texts = (await outbox(trx, w.orgId, "send_result"))
        .filter((row) => row.user_id === w.owner)
        .map((row) => row.dedup_key);
      expect(texts.sort()).toEqual([`send_result:${rejected.sendId}`, `send_result:${expired.sendId}`].sort());
      const expiredRow = (await outbox(trx, w.orgId, "send_result")).find(
        (row) => row.dedup_key === `send_result:${expired.sendId}` && row.user_id === w.owner
      );
      expect(expiredRow?.text).toBe("⌛ Follow-up not sent: the open loop was closed.");
    });
  });

  test("an edited Drafts copy ends a follow-up as draft_changed: one result row per owner with the loop id and no mail id", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const changed = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "expired",
        notifiedAt: at(-HOUR_MS),
      });
      await trx
        .updateTable("actions")
        .set({ status_reason: "draft_changed" })
        .where("id", "=", changed.sendId)
        .execute();

      await run(trx);

      const row = (await outbox(trx, w.orgId, "send_result")).find(
        (found) => found.dedup_key === `send_result:${changed.sendId}` && found.user_id === w.owner
      );
      expect(row?.text).toBe("✏️ Follow-up not sent: you edited this draft in your mail client. Send it from there.");
      expect(row?.loop_id).not.toBeNull();
      expect(row?.email_id).toBeNull();
    });
  });
});

describe("T3b a failed follow-up: one fixed action_failed notice, no recipient, no text", () => {
  test("a failure at SMTP gives one row per owner with the loop id and the fixed text; a failed mail send keeps its result line", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        to: ["secret-anna@example.test"],
        subject: "SECRET-SUBJECT",
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
        send: { status_reason: "smtp_error", attempts: 3 },
      });
      const unknown = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
        send: { status_reason: "outcome_unknown" },
      });
      const { insertDraftAndSend } = await import("./fixtures");
      const mail = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
      });
      await run(trx);

      const failed = (await outbox(trx, w.orgId, "action_failed")).filter((row) => row.loop_id !== null);
      // Two follow-ups, four owners; the member and nobody else is left out.
      expect(failed).toHaveLength(8);
      expect(users(failed.filter((row) => row.dedup_key === `action_failed:${f.sendId}`))).toEqual(
        [w.owner, w.owner2, w.oldOwner, w.noConsentOwner].sort()
      );
      for (const row of failed) {
        expect(row.email_id).toBeNull();
        expect(row.buttons).toEqual([]);
      }
      const texts = (id: string) => [
        ...new Set(failed.filter((row) => row.dedup_key === `action_failed:${id}`).map((row) => row.text)),
      ];
      expect(texts(f.sendId)).toEqual([
        "⚠️ A follow-up could not be sent. Nothing went out.\nOpen in panel: https://panel.example.test/approvals",
      ]);
      expect(texts(unknown.sendId)).toEqual([
        "⚠️ A follow-up may have been sent: the connection broke after the text went out. Check your Sent folder before you write another.\nOpen in panel: https://panel.example.test/approvals",
      ]);
      // Neither the recipient nor the subject is in any stored row, and a failed follow-up gets no result line.
      expect(JSON.stringify(failed)).not.toContain("secret-anna@example.test");
      expect(JSON.stringify(failed)).not.toContain("SECRET-SUBJECT");
      expect((await outbox(trx, w.orgId, "send_result")).filter((row) => row.loop_id !== null)).toEqual([]);
      // The result detector never even tried it: no skipped-notice warning for a failed follow-up.
      expect(warnings.filter((line) => line.includes("notice_skipped kind=send_result"))).toEqual([]);
      // The mail send is told by its result line, once, with the Send again button; the follow-up marks keep a rerun quiet.
      expect((await outbox(trx, w.orgId, "send_result")).filter((row) => row.email_id === mail.emailId)).toHaveLength(
        4
      );
      const total = (await outbox(trx, w.orgId)).length;
      await run(trx);
      expect((await outbox(trx, w.orgId)).length).toBe(total);
    });
  });

  test("with no linked owner nothing is queued or marked, so the notice comes when an owner links", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        sendStatus: "failed",
        notifiedAt: at(-HOUR_MS),
      });
      // Only the assistant keeps a chat: the organization is visited, but it has no owner to tell.
      await trx.deleteFrom("chat_links").where("org_id", "=", w.orgId).where("user_id", "<>", w.member).execute();
      await run(trx);
      const mark = await trx
        .selectFrom("actions")
        .select("result_notified_at")
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(mark.result_notified_at).toBeNull();
    });
  });
});

describe("a send held by a limit (G13)", () => {
  test("approved follow-ups held by a limit give one fixed send_held line per owner and day; the mail hold keeps its own", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const held = { last_error: "send_limit:mailbox_hour", next_attempt_at: at(HOUR_MS) };
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { sendStatus: "approved", send: held });
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { sendStatus: "approved", send: held });
      await run(trx);
      const rows = await outbox(trx, w.orgId, "send_held");
      expect(users(rows)).toEqual([w.owner, w.owner2, w.oldOwner, w.noConsentOwner].sort());
      for (const row of rows) {
        expect(row.dedup_key).toBe(`send_held_follow_up:${w.mailboxId}:2026-11-20`);
        expect(row.text?.split("\n")[0]).toBe(
          "⏸ A follow-up waits: the hourly send limit of this mailbox is reached."
        );
        expect(row.text).toContain("2 waiting");
        expect(row.text).toContain("Open in panel: https://panel.example.test/approvals");
        expect(row.text).not.toContain("@");
      }
      await run(trx);
      expect(await outbox(trx, w.orgId, "send_held")).toHaveLength(4);
      // When the hold ends, a notice that no sender took yet is cancelled.
      await trx
        .updateTable("actions")
        .set({ next_attempt_at: at(-MINUTE_MS) })
        .where("org_id", "=", w.orgId)
        .execute();
      await run(trx);
      expect((await outbox(trx, w.orgId, "send_held")).every((row) => row.status === "failed")).toBe(true);
    });
  });
});

describe("the card of a follow-up whose loop closed loses its buttons", () => {
  test("a sent card gets one expired edit; a pending card is cancelled; a rerun adds nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      const cards = await outbox(trx, w.orgId, "approval");
      expect(cards).toHaveLength(2);
      // The first card went out; the second is still pending.
      const [sentCard, pendingCard] = cards;
      await trx
        .updateTable("outbox")
        .set({ status: "sent", text: sentCard?.text ?? "", external_message_id: 4242, sent_at: at(MINUTE_MS) })
        .where("id", "=", sentCard?.id ?? "")
        .execute();
      // The loop closes: the committer, the switch-off and the close rules end the send directly.
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "loop_closed", updated_at: at(5 * MINUTE_MS) })
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      const edits = await outbox(trx, w.orgId, "approval_edit");
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({ user_id: sentCard?.user_id, loop_id: f.loopId, email_id: null });
      expect(edits[0]?.dedup_key).toBe(`approval_edit:${sentCard?.id}:expired`);
      expect(edits[0]?.text).toContain("⌛ Expired");
      expect(edits[0]?.text?.startsWith("📝 Follow-up")).toBe(true);
      const pending = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("id", "=", pendingCard?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(pending).toEqual({ status: "failed", error_code: "answered_elsewhere" });
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval_edit")).toHaveLength(1);
    });
  });

  test("a tap on one card edits the other owner's card in place, with the loop id and no mail id", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      await trx
        .updateTable("outbox")
        .set((eb) => ({ status: "sent", text: eb.ref("dedup_key"), external_message_id: 77, sent_at: at(MINUTE_MS) }))
        .where("org_id", "=", w.orgId)
        .where("kind", "=", "approval")
        .execute();
      const { approve, noDelegationHooks: none } = await import("../../src/modules/actions");
      const { cardEditHooks } = await import("../../src/modules/channels");
      const deps = {
        db: trx,
        hooks: none,
        approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
        uidplus: async () => true,
      };
      expect(
        (await approve(deps, w.ctx, f.sendId, { userId: w.owner, via: "telegram", now: at(2 * MINUTE_MS) })).kind
      ).toBe("approved");
      // The tapped card is edited by the tap answer; the other owner's card gets an `approval_edit` row of the loop.
      const edits = await outbox(trx, w.orgId, "approval_edit");
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({ user_id: w.owner2, loop_id: f.loopId, email_id: null });
      expect(edits[0]?.text).toContain("Approved");
    });
  });

  test("a closed loop whose cards were never sent: the pending cards are cancelled, no edit is queued", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toHaveLength(2);
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "loop_closed" })
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      const cards = await outbox(trx, w.orgId, "approval");
      expect(cards.every((card) => card.status === "failed")).toBe(true);
      expect(await outbox(trx, w.orgId, "approval_edit")).toEqual([]);
    });
  });

  test("a send that expired for another reason gets no edit from this detector (the hourly job edits no card)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      await trx
        .updateTable("outbox")
        .set((eb) => ({ status: "sent", text: eb.ref("dedup_key"), external_message_id: 1, sent_at: at(MINUTE_MS) }))
        .where("kind", "=", "approval")
        .execute();
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "timeout" })
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval_edit")).toEqual([]);
    });
  });
});

describe("the cards that a closed loop still lists (the limit must not clog)", () => {
  test("a sent card whose text was removed or that has no message id is not listed; a normal sent card and a pending card are", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const mk = async (minutesAgo: number) => {
        const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
        await trx
          .updateTable("actions")
          .set({ status: "expired", status_reason: "loop_closed", updated_at: at(-minutesAgo * MINUTE_MS) })
          .where("id", "=", f.sendId)
          .execute();
        return f;
      };
      const card = async (sendId: string, loopId: string, patch: Record<string, unknown>) =>
        trx
          .insertInto("outbox")
          .values({
            org_id: w.orgId,
            user_id: w.owner,
            kind: "approval",
            dedup_key: `approval:${sendId}`,
            loop_id: loopId,
            text: "CARD",
            status: "sent",
            external_message_id: 5,
            sent_at: at(0),
            next_attempt_at: at(0),
            created_at: at(0),
            ...patch,
          })
          .execute();
      // The useless ones are the oldest: with a limit of one they would hide the good card if they were listed.
      const removed = await mk(50);
      await card(removed.sendId, removed.loopId, { text: "[removed]" });
      const noId = await mk(30);
      await card(noId.sendId, noId.loopId, { external_message_id: null });
      const good = await mk(20);
      await card(good.sendId, good.loopId, {});
      const pending = await mk(10);
      await card(pending.sendId, pending.loopId, {
        status: "pending",
        text: null,
        external_message_id: null,
        sent_at: null,
      });
      expect((await listClosedFollowUpCards(trx, w.ctx, { limit: 10 })).map((row) => row.sendId)).toEqual([
        good.sendId,
        pending.sendId,
      ]);
      expect((await listClosedFollowUpCards(trx, w.ctx, { limit: 1 })).map((row) => row.sendId)).toEqual([good.sendId]);
    });
  });
});

describe("T7 the 48 hour expiry of a follow-up", () => {
  test("a follow-up not tapped for 48 h expires and the loop stays open; a fresh one stays", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const old = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        notifiedAt: new Date(T.getTime() - 49 * HOUR_MS),
      });
      const fresh = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        notifiedAt: new Date(T.getTime() - 47 * HOUR_MS),
      });
      // The card of the old one went out: the request counts as seen, so the reason is `timeout`.
      await trx
        .insertInto("outbox")
        .values({
          org_id: w.orgId,
          user_id: w.owner,
          kind: "approval",
          dedup_key: `approval:${old.sendId}`,
          loop_id: old.loopId,
          view: JSON.stringify({}),
          text: "CARD",
          status: "sent",
          next_attempt_at: T,
          created_at: T,
          sent_at: T,
          external_message_id: 5,
        })
        .execute();
      await createExpiryJob({ db: trx, now: () => T, hooks: noDelegationHooks, uidplus: async () => true }).run();
      const state = async (id: string) =>
        trx.selectFrom("actions").select(["status", "status_reason"]).where("id", "=", id).executeTakeFirstOrThrow();
      expect(await state(old.sendId)).toEqual({ status: "expired", status_reason: "timeout" });
      expect(await state(fresh.sendId)).toEqual({ status: "awaiting_approval", status_reason: null });
      const loops = await trx.selectFrom("open_loops").select(["id", "status"]).where("org_id", "=", w.orgId).execute();
      expect(loops.every((loop) => loop.status === "open")).toBe(true);
      const audit = await trx
        .selectFrom("audit_log")
        .select(["reason_code", "data"])
        .where("action_id", "=", old.sendId)
        .execute();
      expect(audit).toEqual([
        { reason_code: "timeout", data: { action_type: "send", reason: "timeout", loop_id: old.loopId } },
      ]);
      // The result notice of the expired follow-up: one row per covered owner.
      await run(trx);
      const results = await outbox(trx, w.orgId, "send_result");
      expect(users(results)).toEqual([w.owner, w.owner2].sort());
      expect(results[0]?.text).toBe("⌛ Follow-up not sent: the approval expired (48 h).");
    });
  });
});

describe("a follow-up that no owner could see (every owner uncovered)", () => {
  test("the hourly job ends it after 48 h with the reason the code gives; the loop stays open", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      for (const user of [w.owner, w.owner2]) await consentRow(trx, w.orgId, user, OLD_CONSENT, at(-10 * MINUTE_MS));
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toEqual([]);
      const later = at(49 * HOUR_MS);
      await createExpiryJob({ db: trx, now: () => later, hooks: noDelegationHooks, uidplus: async () => true }).run();
      const row = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "expired", status_reason: "not_seen" });
      const loop = await trx
        .selectFrom("open_loops")
        .select("status")
        .where("id", "=", f.loopId)
        .executeTakeFirstOrThrow();
      expect(loop.status).toBe("open");
    });
  });
});

describe("a follow-up is never in an approval set", () => {
  test("a forged set_id in the payload gives one card, no set row, and the set tap approves nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const setId = "11111111-1111-4111-8111-111111111111";
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      // The stored payload carries a set id (a bug or a forged write): the readers must not trust it.
      await trx
        .updateTable("actions")
        .set((eb) => ({
          payload: eb.fn("jsonb_set", [eb.ref("payload"), eb.val("{set_id}"), eb.val(JSON.stringify(setId))]),
        }))
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval_set")).toEqual([]);
      // It is one single card per covered owner, whatever the stored payload says about a set.
      expect(users(await outbox(trx, w.orgId, "approval"))).toEqual([w.owner, w.owner2].sort());
      const { approveSet, rejectSet } = await import("../../src/modules/actions");
      const deps = {
        db: trx,
        hooks: noDelegationHooks,
        approvalHooks: { onDecided: async () => undefined },
        uidplus: async () => true,
      };
      const result = await approveSet(deps, w.ctx, setId, { userId: w.owner, via: "telegram", now: T });
      expect(result).toEqual({ approved: 0, skipped: 0, approvedIds: [] });
      expect(await rejectSet(deps, w.ctx, setId, { userId: w.owner, via: "telegram", now: T })).toEqual({
        rejected: 0,
        skipped: 0,
      });
      const row = await trx.selectFrom("actions").select("status").where("id", "=", f.sendId).executeTakeFirstOrThrow();
      expect(row.status).toBe("awaiting_approval");
      // The tap on its own card still decides it (the card edit and the audit name the loop).
      const { approve } = await import("../../src/modules/actions");
      expect((await approve(deps, w.ctx, f.sendId, { userId: w.owner, via: "telegram", now: T })).kind).toBe(
        "approved"
      );
    });
  });
});
