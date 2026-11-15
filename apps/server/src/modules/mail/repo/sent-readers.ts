import type { TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";

import { getSentSyncState, isSentErrorCode, type SentErrorCode } from "./sent-state";
import type { DbOrTrx } from "./shared";

const ANSWER_CHUNK = 500;

export interface UserAnswer {
  answeredAt: Date;
  sentEmailId: string;
}

// The earliest reply of the user to each incoming mail: a user row of the same mailbox, in any Sent folder, whose parent id is the
// mail's Message-ID. A system send never counts. The order is the send time, then the row id. Ids without a reply are absent.
export async function listUserAnswers(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, UserAnswer>> {
  const answers = new Map<string, UserAnswer>();
  for (let start = 0; start < emailIds.length; start += ANSWER_CHUNK) {
    const chunk = emailIds.slice(start, start + ANSWER_CHUNK);
    const rows = await db
      .selectFrom("emails as e")
      .innerJoin("sent_emails as s", (join) =>
        join
          .onRef("s.org_id", "=", "e.org_id")
          .onRef("s.mailbox_id", "=", "e.mailbox_id")
          .onRef("s.parent_message_id", "=", "e.message_id_header")
      )
      .distinctOn("e.id")
      .select(["e.id as emailId", "s.id as sentEmailId", "s.sent_at as answeredAt"])
      .where("e.org_id", "=", ctx.orgId)
      .where("e.id", "in", chunk)
      .where("s.org_id", "=", ctx.orgId)
      .where("s.origin", "=", "user")
      .orderBy("e.id")
      .orderBy("s.sent_at")
      .orderBy("s.id")
      .execute();
    for (const row of rows) answers.set(row.emailId, { answeredAt: row.answeredAt, sentEmailId: row.sentEmailId });
  }
  return answers;
}

export interface SentSummary {
  userCount: number;
  newestUserAt: Date | null;
}

// User mail in the current Sent folder of the mailbox: the count since `since` and the newest INTERNALDATE of any age.
// No state or no folder path: nothing was read.
export async function getSentSummary(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date }
): Promise<SentSummary> {
  const state = await getSentSyncState(db, ctx, mailboxId);
  if (state === undefined || state.path === null) return { userCount: 0, newestUserAt: null };
  const row = await db
    .selectFrom("sent_emails")
    .select((eb) => [
      eb.fn.countAll().filterWhere("internal_date", ">=", opts.since).as("userCount"),
      eb.fn.max("internal_date").as("newestUserAt"),
    ])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("origin", "=", "user")
    .where("path", "=", state.path)
    .executeTakeFirstOrThrow();
  return { userCount: Number(row.userCount), newestUserAt: row.newestUserAt };
}

export interface SentHealthRow {
  mailboxId: string;
  firstPassAt: Date;
  lastPassAt: Date | null;
  newestUserAt: Date | null;
  lastErrorCode: SentErrorCode | null;
}

// One row per mailbox of the organization with the switch on and a finished first pass.
export async function listSentHealth(db: DbOrTrx, ctx: TenantContext): Promise<SentHealthRow[]> {
  const rows = await db
    .selectFrom("mailbox_sent_sync as st")
    .select((eb) => [
      "st.mailbox_id",
      "st.first_pass_at",
      "st.last_pass_at",
      "st.last_error_code",
      eb
        .selectFrom("sent_emails as s")
        .select((sub) => sub.fn.max("s.internal_date").as("newest"))
        .whereRef("s.org_id", "=", "st.org_id")
        .whereRef("s.mailbox_id", "=", "st.mailbox_id")
        .whereRef("s.path", "=", "st.path")
        .where("s.origin", "=", "user")
        .as("newestUserAt"),
    ])
    .where("st.org_id", "=", ctx.orgId)
    .where("st.enabled", "=", true)
    .where("st.first_pass_at", "is not", null)
    .orderBy("st.mailbox_id")
    .execute();
  return rows.map((row) => {
    if (row.first_pass_at === null) throw new HardError("a sent health row has no first pass");
    if (row.last_error_code !== null && !isSentErrorCode(row.last_error_code)) {
      throw new HardError("mailbox_sent_sync row has an unknown error code");
    }
    return {
      mailboxId: row.mailbox_id,
      firstPassAt: row.first_pass_at,
      lastPassAt: row.last_pass_at,
      newestUserAt: row.newestUserAt,
      lastErrorCode: row.last_error_code,
    };
  });
}
