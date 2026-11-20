import { HOUR_MS } from "@ea/core";
import type { DkimSignature } from "@ea/core";
import type { Hono } from "hono";

import { upsertOrgFeature } from "../../src/modules/tenancy";
import { newsletterRoutes } from "../../src/modules/triage";
import type { Db } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";
import type { OneClickResult } from "../../src/platform/public-http";

import { insertTriaged } from "./fixtures";
import { addMailbox } from "./trust-fixtures";
import { webOrg, webTestApp, type WebOrg } from "./web-helpers";

// Committed rows for the newsletters route: an organization with an owner and a member (role `assistant`), one
// mailbox each for it and for a second organization, and the flag `bulk_unsubscribe`.
export const NOW = new Date("2026-11-18T12:00:00Z");
export const TRUSTED = ["interia.pl"];
export const PASS = "interia.pl; dkim=pass header.d=c.example";
export const LINK = "<https://u.c.example/unsub?id=1>, <mailto:unsub@c.example>";

export interface NewsletterBox {
  org: WebOrg;
  mailboxId: string;
  otherMailboxId: string;
  /** The URLs that the fake client got (no test sends a real request). */
  posts: string[];
  /** What the fake client answers next. Default `ok` / `http_200`. */
  answer: { result: OneClickResult; delayMs: number; onPost?: () => Promise<void>; throws?: boolean };
  app(trusted?: readonly string[]): Hono<ApiEnv>;
  cleanup(): Promise<void>;
}

export async function newsletterBox(
  db: Db,
  opts: { flag?: boolean; post?: (url: URL) => Promise<OneClickResult> } = {}
): Promise<NewsletterBox> {
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
  const posts: string[] = [];
  const answer: NewsletterBox["answer"] = { result: { kind: "ok", code: "http_200" }, delayMs: 0 };
  const post = async (url: URL): Promise<OneClickResult> => {
    posts.push(url.href);
    if (answer.throws) throw new Error("fake client crash");
    await answer.onPost?.();
    if (answer.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
    return answer.result;
  };
  return {
    org,
    mailboxId,
    otherMailboxId,
    posts,
    answer,
    app: (trusted = TRUSTED) =>
      webTestApp({
        db,
        sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
        routers: (api) =>
          api.route(
            "/",
            newsletterRoutes({ db, now: () => NOW, trustedAuthservIds: trusted, post: opts.post ?? post })
          ),
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
  /** The stored `dkim_signatures`; default: one signature of the `header.d` domain of `authResults` that covers both list headers when `post` is true. */
  signatures?: DkimSignature[] | null;
}

// One signature that covers both list headers, for the domain of the `header.d` of the mail's `Authentication-Results`.
const covering = (authResults: string | null | undefined): DkimSignature[] => [
  {
    d: /header\.d=([^\s;]+)/.exec(authResults ?? "")?.[1] ?? "c.example",
    h: ["from", "to", "subject", "list-unsubscribe", "list-unsubscribe-post"],
  },
];

// SQL NULL for a row from before the column, else the JSON array.
const signaturesJson = (value: DkimSignature[] | null): string | null =>
  value === null ? null : JSON.stringify(value);

/** A triaged mail with its header row, committed. */
export async function addSenderMail(db: Db, orgId: string, mailboxId: string, m: SenderMail): Promise<string> {
  const at = new Date(NOW.getTime() - (m.hoursAgo ?? 1) * HOUR_MS);
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
        dkim_signatures: signaturesJson(
          m.signatures === undefined ? (m.post === true ? covering(m.authResults) : null) : m.signatures
        ),
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
  over: {
    status?: "requested" | "done" | "failed" | "refused";
    code?: string | null;
    finishedAt?: Date | null;
    createdAt?: Date;
  } = {}
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
      created_at: over.createdAt ?? new Date(NOW.getTime() - 2 * HOUR_MS),
      finished_at:
        over.finishedAt === undefined
          ? status === "requested"
            ? null
            : new Date(NOW.getTime() - HOUR_MS)
          : over.finishedAt,
    })
    .execute();
}
