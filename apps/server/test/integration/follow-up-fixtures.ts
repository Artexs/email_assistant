import { randomUUID } from "node:crypto";

import { OPEN_LOOPS_CONSENT_SINCE, sendPayloadFor, type DraftPayload } from "@ea/core";
import type { Insertable, Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import type { DB, Db } from "../../src/platform/db";

import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";

// Rows for the tests of the follow-up cards, lists and expiry (F116 stage 11). A follow-up is a loop with its sent mail and
// the draft and the send that depend on it. `conn` is a rolled-back transaction or the committed `db` (the race tests).

export const SENT_AT = "2026-11-10T09:30:00.000Z";
type Conn = Db | Transaction<DB>;

export interface FollowUpOpts {
  to?: string[];
  cc?: string[];
  n?: 1 | 2;
  draftStatus?: string;
  sendStatus?: string;
  createdAt?: Date;
  notifiedAt?: Date | null;
  subject?: string;
  quote?: string | null;
  mailboxId?: string;
  loop?: Partial<Insertable<DB["open_loops"]>>;
  send?: Partial<Insertable<DB["actions"]>>;
  // The draft payload replaces keys (a panel edit, a hostile value).
  draft?: Record<string, unknown>;
}

export interface FollowUp {
  loopId: string;
  draftId: string;
  sendId: string;
  draftPayload: DraftPayload;
}

const inTx = <T>(conn: Conn, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
  conn.isTransaction ? run(conn as Transaction<DB>) : (conn as Db).transaction().execute(run);

// One loop, its sent mail, and the follow-up pair. Defaults: an `applied` draft and a send that waits for a tap.
export async function insertFollowUp(
  conn: Conn,
  ctx: { orgId: string },
  mailboxId: string,
  userId: string,
  opts: FollowUpOpts = {}
): Promise<FollowUp> {
  return inTx(conn, async (trx) => {
    const to = opts.to ?? [`anna-${randomUUID()}@x.test`];
    const cc = opts.cc ?? [`jan-${randomUUID()}@x.test`];
    const subject = opts.subject ?? "Offer Q1";
    const box = opts.mailboxId ?? mailboxId;
    const sent = await insertSentRow(trx, ctx, box, { toAddresses: to, ccAddresses: cc, subject });
    const loopId = await insertLoopRow(trx, ctx, box, {
      sent_email_id: sent,
      message_id: "<own-1@x.test>",
      references_ids: ["<root@x.test>"],
      subject,
      to_addresses: to,
      cc_addresses: cc,
      counterpart: to[0] ?? null,
      language: "en",
      ...opts.loop,
    });
    const draftPayload = {
      kind: "follow_up",
      loop_id: loopId,
      to,
      cc,
      language: "en",
      sent_at: SENT_AT,
      subject,
      quote: opts.quote === undefined ? "Can you send the numbers by Friday?" : opts.quote,
      n: opts.n ?? 1,
      ...opts.draft,
    } as DraftPayload;
    const approved = ["approved", "applying", "applied"].includes(opts.sendStatus ?? "");
    const ids = await insertLoopActionPair(trx, ctx, loopId, {
      draftStatus: opts.draftStatus ?? "applied",
      ...(opts.sendStatus === undefined ? {} : { sendStatus: opts.sendStatus }),
      createdAt: opts.createdAt ?? new Date(),
      notifiedAt: opts.notifiedAt ?? null,
      payloads: { draft: draftPayload, send: sendPayloadFor(draftPayload) },
      draft: { provider_result: JSON.stringify({ folder: "Drafts", uid: 1 }) },
      send: {
        ...(approved ? { approved_at: new Date(), approved_by: userId, approved_via: "telegram" } : {}),
        ...opts.send,
      },
    });
    return { loopId, ...ids, draftPayload };
  });
}

// A consent row of the Telegram terms (the audit row that `POST /telegram/consent` writes).
export async function consentRow(
  conn: Conn,
  orgId: string,
  userId: string,
  version: string | null,
  at: Date
): Promise<void> {
  await recordAudit(
    conn,
    { orgId },
    {
      event: auditEvents.webTelegramConsent,
      actor: userId,
      data: version === null ? { via: "web" } : { via: "web", version },
      at,
    }
  );
}

// An unlink row, as `unlinkUser` and the chat move write it.
export async function unlinkRow(conn: Conn, orgId: string, userId: string, at: Date): Promise<void> {
  await recordAudit(
    conn,
    { orgId },
    { event: auditEvents.chatUnlinked, actor: "system", data: { channel: "telegram", user_id: userId, links: 1 }, at }
  );
}

export const CURRENT_CONSENT = OPEN_LOOPS_CONSENT_SINCE;
export const OLD_CONSENT = "2026-11-15";
