// The one-click unsubscribe command of the newsletters list (RFC 8058). The owner taps once; this code
// re-checks that the sender is still allowed, writes the intent row and commits it, and only then sends the request through
// the guarded client (`platform/public-http.ts`). The URL comes from the stored `List-Unsubscribe` header of a sender whose
// `Authentication-Results` is trusted and on top (`listNewsletterSenders` decides `oneClick`); it is untrusted mail text. It is
// never stored, logged or written to the audit row: the row and the audit hold the sender domain and a short code.
import { HOUR_MS, type UnsubscribeRequestStatus } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import type { OneClickResult } from "../../platform/public-http";
import { auditEvents, recordAudit } from "../audit";
import { getMailbox } from "../mail";

import { listNewsletterSenders } from "./newsletter-senders";

/** At most this many requests per organization in the last hour. */
export const UNSUBSCRIBE_ORG_LIMIT = 20;
/** At most this many requests per organization and sender domain in the last hour (the domain is the sender, not the target). */
export const UNSUBSCRIBE_DOMAIN_LIMIT = 3;
const WINDOW_MS = HOUR_MS;

export interface UnsubscribeDeps {
  db: Db;
  now(): Date;
  /** `mailTrustedAuthservIds(config)`. */
  trustedAuthservIds: readonly string[];
  /** Sends the request. Production: `postOneClick` with the system lookup. */
  post(url: URL): Promise<OneClickResult>;
}

export type UnsubscribeOutcome =
  | { kind: "not_found" }
  | { kind: "not_allowed" }
  | { kind: "no_one_click" }
  | { kind: "rate_limited" }
  | { kind: "already_requested"; request: { status: UnsubscribeRequestStatus; at: Date } }
  | { kind: "finished"; status: "done" | "failed" | "refused"; code: string; at: Date };

// Phase 1 (one transaction): the stored row of a second tap, the two rate limits, the intent row.
type Intent =
  | { kind: "created"; id: string }
  | { kind: "already_requested"; request: { status: UnsubscribeRequestStatus; at: Date } }
  | { kind: "rate_limited" };

async function storedRequest(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  senderLower: string
): Promise<Extract<Intent, { kind: "already_requested" }> | undefined> {
  const row = await trx
    .selectFrom("unsubscribe_requests")
    .select(["status", "created_at", "finished_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("sender_lower", "=", senderLower)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    kind: "already_requested",
    request: { status: row.status as UnsubscribeRequestStatus, at: row.finished_at ?? row.created_at },
  };
}

async function writeIntent(
  db: Db,
  ctx: TenantContext,
  input: { mailboxId: string; senderLower: string; domain: string; now: Date }
): Promise<Intent> {
  return db.transaction().execute(async (trx): Promise<Intent> => {
    // One writer per organization: the two counts and the insert cannot interleave with a parallel tap.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`unsubscribe:${ctx.orgId}`}, 0))`.execute(trx);
    const stored = await storedRequest(trx, ctx, input.mailboxId, input.senderLower);
    if (stored !== undefined) return stored;

    const since = new Date(input.now.getTime() - WINDOW_MS);
    const recent = async (domain?: string): Promise<number> => {
      const query = trx
        .selectFrom("unsubscribe_requests")
        .select(sql<string>`count(*)::text`.as("n"))
        .where("org_id", "=", ctx.orgId)
        .where("created_at", ">", since);
      return Number(
        (await (domain === undefined ? query : query.where("sender_domain", "=", domain)).executeTakeFirstOrThrow()).n
      );
    };
    if ((await recent()) >= UNSUBSCRIBE_ORG_LIMIT) return { kind: "rate_limited" };
    if ((await recent(input.domain)) >= UNSUBSCRIBE_DOMAIN_LIMIT) return { kind: "rate_limited" };

    const row = await trx
      .insertInto("unsubscribe_requests")
      .values({
        org_id: ctx.orgId,
        mailbox_id: input.mailboxId,
        sender_lower: input.senderLower,
        sender_domain: input.domain,
        method: "one_click",
        status: "requested",
        created_at: input.now,
      })
      .onConflict((conflict) => conflict.columns(["mailbox_id", "sender_lower"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (row !== undefined) return { kind: "created", id: row.id };
    // The advisory lock makes this unreachable for two taps of one organization; the unique key still decides.
    const winner = await storedRequest(trx, ctx, input.mailboxId, input.senderLower);
    if (winner === undefined) throw new Error("unsubscribe request vanished");
    return winner;
  });
}

// Phase 3: the end state and its audit row in one transaction. The `WHERE status = 'requested'` guard keeps a row that another
// process already finished.
async function finishIntent(
  db: Db,
  ctx: TenantContext,
  input: { id: string; mailboxId: string; domain: string; result: OneClickResult; actor: string; at: Date }
): Promise<"done" | "failed" | "refused"> {
  const status = input.result.kind === "ok" ? "done" : input.result.kind;
  await db.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable("unsubscribe_requests")
      .set({ status, code: input.result.code, finished_at: input.at })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", input.id)
      .where("status", "=", "requested")
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) return;
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.newsletterUnsubscribe,
      data: { mailbox_id: input.mailboxId, domain: input.domain, status, code: input.result.code },
      at: input.at,
    });
  });
  return status;
}

/**
 * The tap. Order: the mailbox, the sender (re-read now; a sender that is spam, suspicious, not a newsletter or not one-click is
 * refused), the intent row (committed first: a crash after the request leaves `requested` and never a second request), the
 * request, the end state. `null` URL cannot happen for a `oneClick` sender but is refused anyway.
 */
export async function unsubscribeSender(
  deps: UnsubscribeDeps,
  ctx: TenantContext,
  input: { mailboxId: string; sender: string; actor: string }
): Promise<UnsubscribeOutcome> {
  const { db } = deps;
  if ((await getMailbox(db, ctx, input.mailboxId)) === undefined) return { kind: "not_found" };
  const now = deps.now();
  const senderLower = input.sender.trim().toLowerCase();
  const senders = await listNewsletterSenders(db, ctx, input.mailboxId, now, {
    trustedAuthservIds: deps.trustedAuthservIds,
  });
  const sender = senders.find((candidate) => candidate.senderLower === senderLower);
  if (sender === undefined) return { kind: "not_allowed" };
  if (!sender.oneClick || sender.linkUrl === null) return { kind: "no_one_click" };

  const domain = senderLower.slice(senderLower.lastIndexOf("@") + 1);
  const intent = await writeIntent(db, ctx, { mailboxId: input.mailboxId, senderLower, domain, now });
  if (intent.kind !== "created") return intent;

  // `post` never throws (`postOneClick`); a stub that does leaves the row `requested`, which the view shows as "Requested".
  const result = await deps.post(new URL(sender.linkUrl));
  const at = deps.now();
  const status = await finishIntent(db, ctx, {
    id: intent.id,
    mailboxId: input.mailboxId,
    domain,
    result,
    actor: input.actor,
    at,
  });
  return { kind: "finished", status, code: result.code, at };
}
