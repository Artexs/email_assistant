import type { Hono } from "hono";

import { upsertOrgFeature } from "../../src/modules/tenancy";
import { newsletterRoutes } from "../../src/modules/triage";
import type { Db } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";

import { insertTriaged } from "./fixtures";
import { addMailbox } from "./trust-fixtures";
import { webOrg, webTestApp, type WebOrg } from "./web-helpers";

// Committed rows for the newsletters route (F110 stage 23): an organization with an owner and a member (role `assistant`), one
// mailbox each for it and for a second organization, and the flag `bulk_unsubscribe`.
export const NOW = new Date("2026-11-18T12:00:00Z");
const HOUR = 3_600_000;
export const TRUSTED = ["interia.pl"];
export const PASS = "interia.pl; dkim=pass header.d=c.example";
export const LINK = "<https://u.c.example/unsub?id=1>, <mailto:unsub@c.example>";

export interface NewsletterBox {
  org: WebOrg;
  mailboxId: string;
  otherMailboxId: string;
  app(trusted?: readonly string[]): Hono<ApiEnv>;
  cleanup(): Promise<void>;
}

export async function newsletterBox(db: Db, opts: { flag?: boolean } = {}): Promise<NewsletterBox> {
  const org = await webOrg(db);
  const mailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.orgId }));
  const otherMailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.otherOrgId }));
  for (const orgId of [org.orgId, org.otherOrgId]) {
    await upsertOrgFeature(
      db,
      { orgId },
      { flag: "bulk_unsubscribe", enabled: opts.flag ?? true, setBy: "test", setAt: NOW }
    );
  }
  return {
    org,
    mailboxId,
    otherMailboxId,
    app: (trusted = TRUSTED) =>
      webTestApp({
        db,
        sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
        routers: (api) => api.route("/", newsletterRoutes({ db, now: () => NOW, trustedAuthservIds: trusted })),
      }),
    cleanup: () => org.cleanup(),
  };
}

export interface SenderMail {
  from: string;
  category?: "info" | "notification" | "spam" | "urgent";
  hoursAgo?: number;
  fromName?: string | null;
  authResults?: string | null;
  link?: string | null;
  post?: boolean | null;
}

/** A triaged mail with its header row, committed. */
export async function addSenderMail(db: Db, orgId: string, mailboxId: string, m: SenderMail): Promise<string> {
  const at = new Date(NOW.getTime() - (m.hoursAgo ?? 1) * HOUR);
  return db.transaction().execute(async (trx) => {
    const id = await insertTriaged(trx, { orgId }, mailboxId, {
      category: m.category ?? "notification",
      createdAt: at,
      from: m.from,
    });
    await trx
      .insertInto("email_headers")
      .values({
        email_id: id,
        org_id: orgId,
        from_name: m.fromName ?? null,
        auth_results: m.authResults ?? null,
        list_unsubscribe: m.link ?? null,
        list_unsubscribe_post: m.post ?? null,
        parts_known: true,
        captured_at: at,
      })
      .execute();
    return id;
  });
}

/** An `unsubscribe_requests` row, committed. The sender domain is the part after `@`. */
export async function addRequest(
  db: Db,
  orgId: string,
  mailboxId: string,
  sender: string,
  over: { status?: "requested" | "done" | "failed" | "refused"; code?: string | null; finishedAt?: Date | null } = {}
): Promise<void> {
  const status = over.status ?? "requested";
  await db
    .insertInto("unsubscribe_requests")
    .values({
      org_id: orgId,
      mailbox_id: mailboxId,
      sender_lower: sender,
      sender_domain: sender.slice(sender.indexOf("@") + 1),
      method: "one_click",
      status,
      code: over.code ?? (status === "requested" ? null : status),
      created_at: new Date(NOW.getTime() - 2 * HOUR),
      finished_at:
        over.finishedAt === undefined
          ? status === "requested"
            ? null
            : new Date(NOW.getTime() - HOUR)
          : over.finishedAt,
    })
    .execute();
}
