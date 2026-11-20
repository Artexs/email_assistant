import type { Transaction } from "kysely";

import { checkUrgentLatency } from "../../src/modules/operator";
import { loadConfig, sloThresholds } from "../../src/platform/config";
import type { Db, DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTriaged, linkChat, randomChatId } from "./fixtures";
import { withRollback } from "./helpers";

// The three service-level checks that read the database. They read every organization that is not
// `suspended` and return numbers and UUIDs only.

export type Trx = Transaction<DB>;

// The defaults of the SLO keys; the env of the machine must not change them.
export const cfg = sloThresholds(
  loadConfig({
    DATABASE_URL: "postgres://app:pw@127.0.0.1:5433/x",
    CREDENTIALS_KEY: Buffer.alloc(32).toString("base64"),
  })
);
export const noTestMail = { senders: [] };

export const at = (time: string, date = "2026-11-20"): Date => new Date(`${date}T${time}:00Z`);
export const NOW = at("10:00");
export const STARTED = at("08:00");

// Other tests and the dev data leave organizations in the DB. The checks read all of them, so the test hides them first;
// the rollback undoes it.
export function makeInRollback(db: Db) {
  return async function inRollback(fn: (trx: Trx) => Promise<void>): Promise<void> {
    await withRollback(db, async (trx) => {
      await trx.updateTable("organizations").set({ plan: "suspended" }).execute();
      await fn(trx);
    });
  };
}

export async function setMailbox(
  trx: Trx,
  mailboxId: string,
  columns: { last_synced_at?: Date | null; status_changed_at?: Date; created_at?: Date; status?: string }
): Promise<void> {
  await trx.updateTable("mailboxes").set(columns).where("id", "=", mailboxId).execute();
}

// An organization with one mailbox that has a sign of life at 08:00 only.
export async function orgWithMailbox(trx: Trx) {
  const org = await createOrgWithMailbox(trx);
  await setMailbox(trx, org.mailboxId, {
    last_synced_at: null,
    status_changed_at: at("08:00"),
    created_at: at("08:00"),
  });
  return org;
}

// An organization with a linked chat since 2026-11-01 (before every mail of the tests).
export async function urgentOrg(trx: Trx) {
  const org = await orgWithMailbox(trx);
  await linkChat(trx, { orgId: org.orgId }, org.userId, randomChatId(), at("08:00", "2026-11-01"));
  return org;
}

export async function urgentMail(
  trx: Trx,
  org: { orgId: string; mailboxId: string },
  opts: { receivedAt: Date; triagedAt?: Date; sourceFolder?: string; subject?: string; from?: string }
): Promise<string> {
  const emailId = await insertTriaged(trx, { orgId: org.orgId }, org.mailboxId, {
    category: "urgent",
    createdAt: opts.triagedAt ?? opts.receivedAt,
    receivedAt: opts.receivedAt,
    subject: opts.subject ?? null,
    from: opts.from ?? null,
  });
  if (opts.sourceFolder !== undefined) {
    await trx.updateTable("emails").set({ source_folder: opts.sourceFolder }).where("id", "=", emailId).execute();
  }
  return emailId;
}

export async function sentNotice(
  trx: Trx,
  org: { orgId: string; userId: string },
  emailId: string,
  sentAt: Date,
  opts: { kind?: string; status?: string; userId?: string; key?: string } = {}
) {
  await trx
    .insertInto("outbox")
    .values({
      org_id: org.orgId,
      user_id: opts.userId ?? org.userId,
      kind: opts.kind ?? "urgent",
      dedup_key: `${opts.kind ?? "urgent"}:${emailId}${opts.key === undefined ? "" : `:${opts.key}`}`,
      email_id: emailId,
      text: "Urgent",
      buttons: "[]",
      status: opts.status ?? "sent",
      created_at: sentAt,
      next_attempt_at: sentAt,
      sent_at: (opts.status ?? "sent") === "sent" ? sentAt : null,
    })
    .execute();
}

export const urgent = (trx: Trx, now: Date = NOW, startedAt: Date = STARTED) =>
  checkUrgentLatency(trx, now, cfg, startedAt, noTestMail);
