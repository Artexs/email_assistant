import {
  type Category,
  categorySchema,
  localDateTime,
  type SenderHistory,
  type UrgencyProfile,
  DAY_MS,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getEmailHeaders, mailKindFilter, type ClaimedEmail, type TestMailRule, isTestMail } from "../mail";

import type { ClassifierExtras } from "./classifier";
import { deadlinesInWindow } from "./classifier-extras";
import type { ClassifierPart } from "./prompts";

type DbOrTrx = Db | Transaction<DB>;

// The window of the sender history: mail received in the 90 days before this mail.
export const SENDER_HISTORY_DAYS = 90;
const MAX_ATTACHMENTS = 10;

export interface ClassifierExtrasInput {
  // The mailbox of the mail. `urgencyProfile` comes from the batch read of the settings row (triage rule 9).
  mailbox: { id: string; urgencyProfile: UrgencyProfile | null };
  email: Pick<ClaimedEmail, "id" | "from_address" | "received_at" | "message_id_header">;
  // The parts of the production prompt; no `history` part means no history query, no `profile` part no profile read.
  parts: readonly ClassifierPart[];
  // The IANA zone of the organization: `today` of the urgency context is the local date of the mail.
  timezone: string;
  // Test mail has the history of test mail only; real mail the history of real mail only.
  testMail: TestMailRule;
  // The codes of `assessSuspicious`. A flagged mail gets no history (a forged address must not inherit one).
  suspicious: readonly string[];
  // The stored profile of one sender in one mailbox (`classifier-v4` part `profile`); the composition root passes the contacts
  // reader. Absent: no profile. `senderLower` is the trimmed, lower-case address.
  readProfile?: (ctx: TenantContext, mailboxId: string, senderLower: string) => Promise<SenderHistory | null>;
}

// The counts of earlier mail of one sender in this mailbox: `received` and the user's corrections. Counts only: no subject,
// no text and no id leaves this function. `from_address_lower` is the indexed column (`emails_mailbox_sender_idx`):
// never `lower(from_address)`. Every statement filters `org_id`. Zero earlier mail gives `null`.
export async function readSenderHistory(
  db: DbOrTrx,
  ctx: TenantContext,
  input: {
    mailboxId: string;
    // Lower case.
    sender: string;
    before: Date;
    exceptEmailId: string;
    kind: "real" | "synthetic";
    testMail: TestMailRule;
  }
): Promise<NonNullable<ClassifierExtras["senderHistory"]> | null> {
  const since = new Date(input.before.getTime() - SENDER_HISTORY_DAYS * DAY_MS);
  const { rows } = await sql<{ category: string | null; n: number }>`
    WITH earlier AS (
      SELECT emails.id
      FROM emails
      WHERE emails.org_id = ${ctx.orgId}
        AND emails.mailbox_id = ${input.mailboxId}
        AND emails.from_address_lower = ${input.sender}
        AND emails.received_at >= ${since}
        AND emails.received_at < ${input.before}
        AND emails.id <> ${input.exceptEmailId}
        AND ${mailKindFilter(input.kind, input.testMail)}
    )
    SELECT NULL::text AS category, count(*)::int AS n FROM earlier
    UNION ALL
    SELECT newest.true_category AS category, count(*)::int AS n
    FROM earlier
    JOIN LATERAL (
      SELECT tf.verdict, tf.true_category
      FROM triage_feedback tf
      WHERE tf.org_id = ${ctx.orgId} AND tf.email_id = earlier.id
      ORDER BY tf.created_at DESC, tf.id DESC
      LIMIT 1
    ) newest ON true
    WHERE newest.verdict = 'wrong' AND newest.true_category IS NOT NULL
    GROUP BY newest.true_category
  `.execute(db);
  let received = 0;
  const corrections: Partial<Record<Category, number>> = {};
  for (const row of rows) {
    if (row.category === null) received = row.n;
    else corrections[categorySchema.parse(row.category)] = row.n;
  }
  return received === 0 ? null : { days: SENDER_HISTORY_DAYS, received, corrections };
}

// The `ClassifierExtras` of one real or test mail. It reads only what `parts` needs: no
// `history` part, no history query. Attachments are always on; a mail with no `email_headers` row, or with cleared
// texts, has none. Nothing here logs or returns mail text.
export async function loadClassifierExtras(
  db: DbOrTrx,
  ctx: TenantContext,
  input: ClassifierExtrasInput
): Promise<ClassifierExtras> {
  const { email, parts } = input;
  const headers = await getEmailHeaders(db, ctx, email.id);

  let senderHistory: ClassifierExtras["senderHistory"] = null;
  if (parts.includes("history") && input.suspicious.length === 0 && email.from_address !== null) {
    senderHistory = await readSenderHistory(db, ctx, {
      mailboxId: input.mailbox.id,
      sender: email.from_address.trim().toLowerCase(),
      before: email.received_at,
      exceptEmailId: email.id,
      kind: isTestMail({ messageIdHeader: email.message_id_header, fromAddress: email.from_address }, input.testMail)
        ? "synthetic"
        : "real",
      testMail: input.testMail,
    });
  }

  let urgency: ClassifierExtras["urgency"] = null;
  const profile = input.mailbox.urgencyProfile;
  if (parts.includes("urgency") && profile !== null) {
    const today = localDateTime(email.received_at, input.timezone).date;
    urgency = { today, topics: profile.topics, deadlines: deadlinesInWindow(today, profile.deadlines) };
  }

  // A flagged mail gets no profile (a forged address must not inherit one), as it gets no history.
  let senderProfile: ClassifierExtras["senderProfile"] = null;
  if (
    parts.includes("profile") &&
    input.readProfile !== undefined &&
    input.suspicious.length === 0 &&
    email.from_address !== null
  ) {
    senderProfile = await input.readProfile(ctx, input.mailbox.id, email.from_address.trim().toLowerCase());
  }

  return {
    attachments: (headers?.attachments ?? [])
      .filter((item) => !item.inline)
      .slice(0, MAX_ATTACHMENTS)
      .map((item) => ({ name: item.name, type: item.type, size: item.size })),
    isList: headers !== undefined && (headers.listId !== null || headers.listUnsubscribe !== null),
    senderHistory,
    senderProfile,
    urgency,
  };
}
