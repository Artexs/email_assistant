import { randomUUID } from "node:crypto";

import { sendPayloadFor, type Category, type DraftPayload } from "@ea/core";
import type { Transaction } from "kysely";

import { insertInboxFolder } from "../modules/mail/repo";
import type { Db, DB, TenantContext } from "../platform/db";

import { ACTIVITY_FILLERS, ACTIVITY_SUBJECTS, activityFillerSubject } from "./e2e-seed-args";

export interface ActivitySeedResult {
  emailIds: { moved: string; reply: string; unsure: string; delegated: string };
  total: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FIRST_UID = 900_001;

// Runs `fn` in a transaction; inside a transaction it runs on that one.
async function inTransaction<T>(db: Db | Transaction<DB>, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  if (db.isTransaction) return fn(db as Transaction<DB>);
  return db.transaction().execute(fn);
}

interface MailInput {
  uid: number;
  receivedAt: Date;
  subject: string;
  from: string;
  category: Category;
  confidence: number;
  reasonCode: string;
  reason: string;
  fields?: Record<string, unknown>;
}

// One `emails` row and its `triage_results` row. The ids come from the caller, so batches need no `returning`.
async function insertMails(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  mails: MailInput[]
): Promise<string[]> {
  const ids = mails.map(() => randomUUID());
  await trx
    .insertInto("emails")
    .values(
      mails.map((mail, index) => ({
        id: ids[index] as string,
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        dedup_key: `e2e:${randomUUID()}`,
        thread_key: `e2e:${randomUUID()}`,
        content_hash: "e2e",
        uid: mail.uid,
        received_at: mail.receivedAt,
        status: "triaged",
        folder: "INBOX",
        source_folder: "INBOX",
        subject: mail.subject,
        from_address: mail.from,
        message_id_header: `<e2e-activity-${mail.uid}-${randomUUID()}@ea-seed.test>`,
      }))
    )
    .execute();
  await trx
    .insertInto("triage_results")
    .values(
      mails.map((mail, index) => ({
        org_id: ctx.orgId,
        email_id: ids[index] as string,
        category: mail.category,
        confidence: mail.confidence,
        reason_code: mail.reasonCode,
        reason: mail.reason,
        fields: JSON.stringify(mail.fields ?? {}),
        created_at: new Date(mail.receivedAt.getTime() + MINUTE),
      }))
    )
    .execute();
  return ids;
}

interface ActionInput {
  emailId: string;
  type: "move" | "mark_read" | "flag" | "create_draft" | "send";
  status: "applied" | "awaiting_approval";
  payload?: Record<string, unknown>;
  createdAt: Date;
  appliedAt?: Date;
  dependsOnActionId?: string;
  notifiedAt?: Date;
}

async function insertAction(trx: Transaction<DB>, ctx: TenantContext, input: ActionInput): Promise<string> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: input.emailId,
      type: input.type,
      status: input.status,
      payload: JSON.stringify(input.payload ?? {}),
      idempotency_key: `e2e:${randomUUID()}`,
      applied_at: input.status === "applied" ? (input.appliedAt ?? input.createdAt) : null,
      created_at: input.createdAt,
      depends_on_action_id: input.dependsOnActionId ?? null,
      notified_at: input.notifiedAt ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// The rows of S5d B12: M1 moved notification, M2 reply, M3 unsure, M4 delegated, then the fillers.
// The actions of one mail get distinct `created_at` values: the activity read model orders them by it.
export async function seedActivityRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date
): Promise<ActivitySeedResult> {
  return inTransaction(db, async (trx) => {
    const ago = (ms: number): Date => new Date(now.getTime() - ms);
    const [moved, reply, unsure, delegated] = (await insertMails(trx, ctx, mailboxId, [
      {
        uid: FIRST_UID,
        receivedAt: ago(3 * HOUR),
        subject: ACTIVITY_SUBJECTS.moved,
        from: "shop@e2e.test",
        category: "notification",
        confidence: 0.93,
        reasonCode: "automated_system",
        reason: "Automated shipping update.",
      },
      {
        uid: FIRST_UID + 1,
        receivedAt: ago(4 * HOUR),
        subject: ACTIVITY_SUBJECTS.reply,
        from: "anna@e2e.test",
        category: "needs_reply",
        confidence: 0.88,
        reasonCode: "direct_request",
        reason: "Anna asks for an answer.",
      },
      {
        uid: FIRST_UID + 2,
        receivedAt: ago(5 * HOUR),
        subject: ACTIVITY_SUBJECTS.unsure,
        from: "info@e2e.test",
        category: "unsure",
        confidence: 0.4,
        reasonCode: "other",
        reason: "The AI is not sure.",
        fields: { model_category: "info" },
      },
      {
        uid: FIRST_UID + 3,
        receivedAt: ago(6 * HOUR),
        subject: ACTIVITY_SUBJECTS.delegated,
        from: "boss@e2e.test",
        category: "delegation",
        confidence: 0.9,
        reasonCode: "direct_request",
        reason: "A task for Ola.",
      },
    ] as MailInput[])) as [string, string, string, string];

    await insertAction(trx, ctx, {
      emailId: moved,
      type: "move",
      status: "applied",
      payload: { folder: "ai_notifications" },
      createdAt: ago(HOUR),
    });
    await insertAction(trx, ctx, {
      emailId: moved,
      type: "mark_read",
      status: "applied",
      createdAt: ago(HOUR - 1000),
    });
    await insertAction(trx, ctx, { emailId: reply, type: "flag", status: "applied", createdAt: ago(HOUR) });

    const delegate = await trx
      .insertInto("delegates")
      .values({
        org_id: ctx.orgId,
        name: "Ola",
        // The index is (org_id, email) and a mailbox removal keeps the row: a random address.
        email: `e2e-delegate-${randomUUID()}@x.test`,
        competence_tags: [],
        active: true,
      })
      .returning(["id", "email"])
      .executeTakeFirstOrThrow();
    const draft: DraftPayload = {
      kind: "delegation",
      delegate_id: delegate.id,
      delegate_name: "Ola",
      to: [delegate.email],
      task: "Send the Q4 report",
      due_date: "",
      language: "en",
    };
    const draftId = await insertAction(trx, ctx, {
      emailId: delegated,
      type: "create_draft",
      status: "applied",
      payload: { ...draft },
      createdAt: ago(HOUR),
    });
    const sendId = await insertAction(trx, ctx, {
      emailId: delegated,
      type: "send",
      status: "awaiting_approval",
      payload: { ...sendPayloadFor(draft) },
      createdAt: ago(HOUR - 1000),
      dependsOnActionId: draftId,
      // The approval notice job leaves a notified action alone.
      notifiedAt: now,
    });
    await trx
      .insertInto("delegations")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        email_id: delegated,
        delegate_id: delegate.id,
        draft_action_id: draftId,
        send_action_id: sendId,
        status: "drafted",
        task_summary: "Send the Q4 report",
        due_at: new Date(now.getTime() + 2 * DAY),
      })
      .execute();

    const fillers: MailInput[] = [];
    for (let n = 1; n <= ACTIVITY_FILLERS; n++) {
      fillers.push({
        uid: FIRST_UID + 3 + n,
        receivedAt: ago(2 * DAY + n * MINUTE),
        subject: activityFillerSubject(n),
        from: "news@e2e.test",
        category: "info",
        confidence: 0.9,
        reasonCode: "fyi",
        reason: "A newsletter.",
      });
    }
    await insertMails(trx, ctx, mailboxId, fillers);

    return { emailIds: { moved, reply, unsure, delegated }, total: 4 + ACTIVITY_FILLERS };
  });
}

// A paused mailbox of another organization with one moved notification: isolation checks look for its mail id.
export async function seedOtherOrgMail(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  now: Date
): Promise<{ mailboxId: string; emailId: string }> {
  return inTransaction(db, async (trx) => {
    const mailboxId = randomUUID();
    await trx
      .insertInto("mailboxes")
      .values({
        id: mailboxId,
        org_id: ctx.orgId,
        address: "e2e-other@e2e.test",
        imap_host: "127.0.0.1",
        imap_port: 3143,
        smtp_host: "127.0.0.1",
        smtp_port: 3025,
        status: "paused",
        capabilities: JSON.stringify({}),
        folder_map: JSON.stringify({}),
      })
      .execute();
    await insertInboxFolder(trx, ctx, mailboxId);
    const [emailId] = await insertMails(trx, ctx, mailboxId, [
      {
        uid: FIRST_UID,
        receivedAt: new Date(now.getTime() - 3 * HOUR),
        subject: "E2E other organization mail",
        from: "shop@e2e.test",
        category: "notification",
        confidence: 0.9,
        reasonCode: "automated_system",
        reason: "Automated update.",
      },
    ]);
    if (emailId === undefined) throw new Error("no mail was inserted");
    await insertAction(trx, ctx, {
      emailId,
      type: "move",
      status: "applied",
      payload: { folder: "ai_notifications" },
      createdAt: new Date(now.getTime() - HOUR),
    });
    return { mailboxId, emailId };
  });
}
