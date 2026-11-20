import { addressLowerForms, DAY_MS, normalizeAddress, type ReplyMail, replyMatch, SUBJECT_MATCH_DAYS } from "@ea/core";
import { sql } from "kysely";

import { normalizedAddress, type TenantContext } from "../../platform/db";

import type { DbOrTrx, LoopRow } from "./repo";

// The mails one loop reads per call, oldest first. An automatic mail is never a close, so a few of them do not hide a reply.
const MAX_CANDIDATES = 200;

export type ReplyLoopFacts = Pick<
  LoopRow,
  "mailbox_id" | "thread_key" | "message_id" | "to_addresses" | "cc_addresses" | "subject" | "wait_from_at"
>;

export interface ReplyCandidate {
  emailId: string;
  mail: ReplyMail;
}

// The id of the loop mail without brackets, or null when nothing usable is left.
function bareId(messageId: string | null): string | null {
  const bare = (messageId ?? "").trim().replace(/^<|>$/g, "").trim();
  return bare === "" || /[\s<>]/.test(bare) ? null : bare;
}

// The incoming mails of the mailbox after the wait began that can answer the loop. Two reads, each with its own limit, so
// many mails from a recipient cannot hide a reply in the thread: (1) in its thread or naming its Message-ID in In-Reply-To or
// References; (2) from one of its recipients within 30 days. A superset: `replyMatch` decides. Oldest first. A mail in the
// junk folder of the mailbox, or whose latest triage category is `spam`, never counts. The mail joins `email_headers` for the
// auto test; no row means not automatic.
export async function replyCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  loop: ReplyLoopFacts,
  ownAddresses: readonly string[]
): Promise<ReplyCandidate[]> {
  const recipients = [...loop.to_addresses, ...loop.cc_addresses].map(normalizeAddress);
  const lowerForms = [...new Set(recipients.flatMap(addressLowerForms))];
  const id = bareId(loop.message_id);
  const subjectUntil = new Date(loop.wait_from_at.getTime() + SUBJECT_MATCH_DAYS * DAY_MS);
  const own = ownAddresses.map(normalizeAddress);
  const base = () => {
    let query = db
      .selectFrom("emails as e")
      .leftJoin("email_headers as h", (join) =>
        join.onRef("h.email_id", "=", "e.id").onRef("h.org_id", "=", "e.org_id")
      )
      .select([
        "e.id",
        "e.thread_key",
        "e.received_at",
        "e.from_address",
        "e.subject",
        "e.in_reply_to",
        "e.references_header",
        "h.auto_submitted",
        "h.precedence",
      ])
      .where("e.org_id", "=", ctx.orgId)
      .where("e.mailbox_id", "=", loop.mailbox_id)
      .where("e.received_at", ">", loop.wait_from_at)
      .where("e.from_address_lower", "is not", null).where(sql<boolean>`NOT EXISTS (
        SELECT 1 FROM mailbox_folders f
        WHERE f.org_id = e.org_id AND f.mailbox_id = e.mailbox_id AND f.role = 'junk' AND f.path = e.source_folder
      )`).where(sql<boolean>`NOT EXISTS (
        SELECT 1 FROM (
          SELECT tr.category FROM triage_results tr
          WHERE tr.org_id = e.org_id AND tr.email_id = e.id
          ORDER BY tr.created_at DESC, tr.id DESC LIMIT 1
        ) t WHERE t.category = 'spam'
      )`);
    if (own.length > 0)
      query = query.where(sql<boolean>`${normalizedAddress("e.from_address")} not in (${sql.join(own)})`);
    return query.orderBy("e.received_at").orderBy("e.id").limit(MAX_CANDIDATES);
  };
  const byThread = base().where((eb) =>
    eb.or([
      eb("e.thread_key", "=", loop.thread_key),
      ...(id === null
        ? []
        : [
            eb(eb.fn("strpos", [eb.fn.coalesce("e.in_reply_to", eb.val("")), eb.val(id)]), ">", 0),
            eb(eb.fn("strpos", [eb.fn.coalesce("e.references_header", eb.val("")), eb.val(id)]), ">", 0),
          ]),
    ])
  );
  const byRecipient =
    recipients.length === 0
      ? undefined
      : base().where("e.from_address_lower", "in", lowerForms).where("e.received_at", "<=", subjectUntil);
  const [threadRows, recipientRows] = await Promise.all([
    byThread.execute(),
    byRecipient === undefined ? Promise.resolve([]) : byRecipient.execute(),
  ]);
  const rows = new Map([...threadRows, ...recipientRows].map((row) => [row.id, row]));
  return [...rows.values()]
    .sort((a, b) => a.received_at.getTime() - b.received_at.getTime() || (a.id < b.id ? -1 : 1))
    .map((row) => ({
      emailId: row.id,
      mail: {
        threadKey: row.thread_key,
        receivedAt: row.received_at,
        fromAddress: row.from_address,
        subject: row.subject,
        inReplyTo: row.in_reply_to,
        referencesHeader: row.references_header,
        autoSubmitted: row.auto_submitted,
        precedence: row.precedence,
      },
    }));
}

export interface ReplyDecision {
  // The first mail, in order, that closes the loop.
  first: { emailId: string; kind: "thread" | "subject" } | null;
  // An automatic mail came before `first` (or, with no `first`, at all).
  auto: boolean;
}

// First match in `received_at` order wins. An automatic mail only sets `auto`; the search goes on.
export function decideReply(
  loop: ReplyLoopFacts,
  candidates: readonly ReplyCandidate[],
  ownAddresses: readonly string[]
): ReplyDecision {
  let auto = false;
  for (const candidate of candidates) {
    const match = replyMatch(
      {
        threadKey: loop.thread_key,
        messageId: loop.message_id,
        toAddresses: loop.to_addresses,
        ccAddresses: loop.cc_addresses,
        subject: loop.subject,
        waitFromAt: loop.wait_from_at,
      },
      candidate.mail,
      { ownAddresses }
    );
    if (match === "auto") auto = true;
    else if (match !== null) return { first: { emailId: candidate.emailId, kind: match }, auto };
  }
  return { first: null, auto };
}

// The loop reads its own rows and the mails of the database: the one entry of the hook and the job.
export async function readReplyDecision(
  db: DbOrTrx,
  ctx: TenantContext,
  loop: ReplyLoopFacts,
  ownAddresses: readonly string[]
): Promise<ReplyDecision> {
  return decideReply(loop, await replyCandidates(db, ctx, loop, ownAddresses), ownAddresses);
}
