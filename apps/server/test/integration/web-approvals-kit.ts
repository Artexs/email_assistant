import { randomUUID } from "node:crypto";

import { encodeCallback } from "@ea/core";
import type { Transaction } from "kysely";

import type { SendScope } from "../../src/modules/actions";
import { approvalRoutes, cardEditHooks } from "../../src/modules/channels";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks, delegationRoutes } from "../../src/modules/delegation";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { isOrgSuspended, setOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { DB, Db } from "../../src/platform/db";

import { insertDelegate, insertDraftAndSend, linkChat, randomChatId, testCapabilities } from "./fixtures";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

// The world of the approval write tests: an organization with an owner, a member and a second owner who holds a Telegram
// card of every send, a second organization, and the approval routes with the real card hook. A test file builds one kit with its
// own `db`; a kit shares no state with another file.
export const NOW = new Date("2026-11-20T12:00:00Z");
export const ROUTES = ["approve", "reject", "edit"] as const;
export const bodyOf = (route: (typeof ROUTES)[number]) => (route === "edit" ? { subject: "Budget", body: "Text" } : {});

export const post = (who: string, path: string, body: unknown = {}, init: { origin?: string } = {}) => {
  const base = as(who, { method: "POST", body });
  if (init.origin === undefined) return base;
  return { ...base, headers: { ...(base.headers as Record<string, string>), origin: init.origin } };
};

export type SendOpts = Parameters<typeof insertDraftAndSend>[3];

export function approvalKit(db: Db) {
  const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

  const inTrx = <T>(run: (trx: Transaction<DB>) => Promise<T>): Promise<T> => db.transaction().execute(run);

  const orgs: WebOrg[] = [];
  const extraUsers: string[] = [];

  async function cleanup(): Promise<void> {
    for (const org of orgs) await org.cleanup();
    orgs.length = 0;
    if (extraUsers.length > 0) await db.deleteFrom("users").where("id", "in", extraUsers).execute();
    extraUsers.length = 0;
  }

  async function addMailbox(orgId: string): Promise<string> {
    const ctx = { orgId };
    const id = randomUUID();
    await insertMailbox(db, ctx, {
      id,
      address: `approvals-write-${id}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: { ...testCapabilities, uidplus: true },
      folderMap: { drafts: "Drafts" },
    });
    await insertInboxFolder(db, ctx, id);
    await inTrx((trx) => insertDefaultSettings(trx, ctx, id));
    await inTrx((trx) => updateMailboxSettings(trx, ctx, id, { mode: "assist", toolSwitches: SWITCHES }));
    return id;
  }

  // `flag` is `approvals_page` (default on); `delegationFlag` is `delegation_pages` (default off; the delegation routes are mounted always).
  async function setup(opts: { flag?: boolean; delegationFlag?: boolean; sendScope?: SendScope } = {}) {
    const org = await webOrg(db);
    orgs.push(org);
    const ctx = { orgId: org.orgId };
    const mailboxId = await addMailbox(org.orgId);
    const theirMailboxId = await addMailbox(org.otherOrgId);
    if (opts.flag !== false) {
      for (const orgId of [org.orgId, org.otherOrgId]) {
        await setOrgFeature(db, { orgId }, { flag: "approvals_page", enabled: true, actor: "cli", now: NOW });
      }
    }
    if (opts.delegationFlag === true) {
      for (const orgId of [org.orgId, org.otherOrgId]) {
        await setOrgFeature(db, { orgId }, { flag: "delegation_pages", enabled: true, actor: "cli", now: NOW });
      }
    }
    // A second owner with a Telegram chat: U1 and U2 both hold a sent card of the send.
    const u2 = (await insertUser(db, { email: `owner2-${randomUUID()}@x.test`, displayName: "Owner 2" })).id;
    extraUsers.push(u2);
    await insertMembership(db, ctx, { userId: u2, role: "owner" });
    await inTrx((trx) => linkChat(trx, ctx, org.ownerId, randomChatId(), NOW));
    await inTrx((trx) => linkChat(trx, ctx, u2, randomChatId(), NOW));
    const sendScope = opts.sendScope ?? ({ kind: "all" } as const);
    const app = webTestApp({
      db,
      sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
      isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId }),
      routers: (api) => {
        api.route(
          "/",
          approvalRoutes({ db, now: () => NOW, sendScope, hooks: delegationHooks({ db }), uidplus: async () => true })
        );
        api.route(
          "/",
          delegationRoutes({
            db,
            now: () => NOW,
            approvalHooks: cardEditHooks({ sendScope }),
            uidplus: async () => true,
          })
        );
      },
    });
    return { org, ctx, mailboxId, theirMailboxId, u2, app };
  }

  type World = Awaited<ReturnType<typeof setup>>;

  // A send with its draft, and a sent Telegram card for U1 and U2 (as the notifier leaves them).
  async function addSend(s: World, opts: SendOpts = {}, orgId = s.org.orgId, mailboxId = s.mailboxId) {
    const created = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, { orgId }, mailboxId, { createdAt: NOW, notifiedAt: NOW, ...opts }));
    if (orgId === s.org.orgId) {
      for (const [index, userId] of [s.org.ownerId, s.u2].entries()) {
        await db
          .insertInto("outbox")
          .values({
            org_id: orgId,
            user_id: userId,
            kind: "approval",
            dedup_key: `approval:${created.sendId}`,
            email_id: created.emailId,
            text: `CARD-${index}`,
            buttons: JSON.stringify([
              [{ text: "Send", data: encodeCallback({ kind: "approve", actionId: created.sendId }) }],
            ]),
            status: "sent",
            next_attempt_at: NOW,
            created_at: NOW,
            sent_at: NOW,
            external_message_id: 700 + index,
          })
          .execute();
      }
    }
    return created.sendId;
  }

  const insertDelegateNow = (s: World, opts: Parameters<typeof insertDelegate>[2]) =>
    db.transaction().execute((trx) => insertDelegate(trx, s.ctx, opts));

  async function send(id: string) {
    return db
      .selectFrom("actions")
      .select(["status", "status_reason", "approved_by", "approved_via", "payload"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }

  async function auditOf(id: string) {
    return db.selectFrom("audit_log").select(["event", "actor", "data"]).where("action_id", "=", id).execute();
  }

  async function editRows(orgId: string) {
    return db
      .selectFrom("outbox")
      .select(["user_id", "dedup_key", "status"])
      .where("org_id", "=", orgId)
      .where("kind", "=", "approval_edit")
      .execute();
  }

  async function sendCount(orgId: string): Promise<number> {
    const rows = await db
      .selectFrom("actions")
      .select("id")
      .where("org_id", "=", orgId)
      .where("type", "=", "send")
      .execute();
    return rows.length;
  }

  return { cleanup, inTrx, setup, addSend, insertDelegateNow, send, auditOf, editRows, sendCount };
}

export type ApprovalKit = ReturnType<typeof approvalKit>;
export type Seed = Awaited<ReturnType<ApprovalKit["setup"]>>;
