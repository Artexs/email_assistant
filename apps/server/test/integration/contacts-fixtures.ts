import { randomUUID } from "node:crypto";

import { HOUR_MS, DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { refreshMailboxProfiles, type RefreshDeps } from "../../src/modules/contacts";
import { insertMailbox, insertSentSyncState } from "../../src/modules/mail/repo";
import { setOrgFeature, upsertOrgFeature } from "../../src/modules/tenancy";
import { senderKeyHash } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, seedSenderActivity, testCapabilities, type SeededMail } from "./fixtures";

// Helpers of the profile pass tests (`contacts-refresh.test.ts`, `contacts-refresh-guards.test.ts`). The clock is fixed and the
// key is a test key, so no test needs `CREDENTIALS_KEY` in the environment.
export type Trx = Transaction<DB>;

export const NOW = new Date("2026-11-18T10:00:00Z");
export { HOUR_MS as HOUR, DAY_MS as DAY } from "@ea/core";
export const KEY = Buffer.alloc(32, 7).toString("base64");
export const NO_TEST = { senders: [] as string[] };

export const ago = (days: number, hours = 0): Date => new Date(NOW.getTime() - days * DAY_MS - hours * HOUR_MS);
export const ms = (value: Date | null | undefined): number | null => value?.getTime() ?? null;
export const deps = (trx: Trx, testMail = NO_TEST): RefreshDeps => ({ db: trx, credentialsKey: KEY, testMail });
export const hashOf = (orgId: string, address: string): string => senderKeyHash(KEY, orgId, address);

export interface Org {
  ctx: TenantContext;
  mailboxId: string;
  address: string;
}

// An organization with one mailbox and the flag `sender_context` on.
export async function newOrg(trx: Trx, opts: { flag?: boolean; address?: string } = {}): Promise<Org> {
  const address = opts.address ?? `box-${randomUUID()}@x.test`;
  const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
  const ctx = { orgId };
  if (opts.flag !== false)
    await setOrgFeature(trx, ctx, { flag: "sender_context", enabled: true, actor: "cli", now: NOW });
  return { ctx, mailboxId, address };
}

export const refresh = (trx: Trx, org: Org, now = NOW, testMail = NO_TEST) =>
  refreshMailboxProfiles(deps(trx, testMail), org.ctx, org.mailboxId, { now });

export const profileOf = (trx: Trx, org: Org, address: string) =>
  trx
    .selectFrom("sender_profiles")
    .selectAll()
    .where("org_id", "=", org.ctx.orgId)
    .where("mailbox_id", "=", org.mailboxId)
    .where("key_hash", "=", hashOf(org.ctx.orgId, address))
    .executeTakeFirst();

export const countRows = async (trx: Trx, org: Org): Promise<number> =>
  (await trx.selectFrom("sender_profiles").select("id").where("mailbox_id", "=", org.mailboxId).execute()).length;

export const mailsAt = (days: number[], extra: Partial<SeededMail> = {}): SeededMail[] =>
  days.map((day) => ({ at: ago(day), ...extra }));

// One incoming mail and, for a delay pair, the Message-ID that the Sent mail names.
export function mailId(name: string): string {
  return `<${name}-${randomUUID()}@x.test>`;
}

// A second mailbox of the organization.
export async function secondMailbox(trx: Trx, org: Org): Promise<Org> {
  const id = randomUUID();
  const address = `second-${id}@x.test`;
  await insertMailbox(trx, org.ctx, {
    id,
    address,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  return { ctx: org.ctx, mailboxId: id, address };
}

// A suggestion row of the table, as the generator would have written it.
export function insertSuggestion(
  trx: Trx | Db,
  org: Org,
  over: {
    value: string;
    kind: "vip" | "whitelist" | "blocklist";
    scope?: "address" | "domain";
    status?: "open" | "dismissed";
    createdAt?: Date;
    endedAt?: Date;
    mailboxId?: string;
  }
) {
  const open = (over.status ?? "open") === "open";
  return trx
    .insertInto("sender_suggestions")
    .values({
      org_id: org.ctx.orgId,
      mailbox_id: over.mailboxId ?? org.mailboxId,
      key_hash: hashOf(org.ctx.orgId, over.value),
      scope: over.scope ?? "address",
      kind: over.kind,
      pattern: open ? over.value : null,
      status: over.status ?? "open",
      created_at: over.createdAt ?? ago(2),
      ended_at: open ? null : (over.endedAt ?? ago(1)),
      reason: JSON.stringify({ received: 8, answered: 6 }),
    })
    .returning("id")
    .executeTakeFirstOrThrow()
    .then((row) => row.id);
}

// Helpers of the suggestion tests (`contacts-suggestions*.test.ts`).
// An organization with the flags `sender_context` and `sender_suggestions`.
export async function suggestOrg(trx: Trx): Promise<Org> {
  const org = await newOrg(trx);
  await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: true, actor: "cli", now: NOW });
  return org;
}

// Sent coverage: the flag, the switch, a first pass and a last pass at `lastPass`.
export async function withSentCoverage(
  trx: Trx,
  org: Org,
  lastPass: Date = NOW,
  error: "folder_missing" | null = null
) {
  await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
  await insertSentSyncState(trx, org.ctx, org.mailboxId, { enabled: true });
  await trx
    .updateTable("mailbox_sent_sync")
    .set({ first_pass_at: ago(30), last_pass_at: lastPass, last_error_code: error })
    .where("mailbox_id", "=", org.mailboxId)
    .execute();
}

// `n` mails received 1, 2, ... days ago; the first `answered` of them are answered.
export const mails = (n: number, answered: number, extra: Partial<SeededMail> = {}): SeededMail[] =>
  Array.from({ length: n }, (_, i) => ({ at: ago(i + 1), answered: i < answered, ...extra }));

// Two mails that the user corrected to spam.
export const spamMails = (): SeededMail[] =>
  [1, 2].map((day) => ({
    at: ago(day),
    category: "info" as const,
    feedback: [{ verdict: "wrong" as const, trueCategory: "spam" as const }],
  }));

// Two mails that the user moved back out of spam.
export const rescuedMails = (): SeededMail[] =>
  [1, 2].map((day) => ({
    at: ago(day),
    category: "spam" as const,
    feedback: [{ verdict: "wrong" as const, trueCategory: "info" as const }],
  }));

export const seed = (trx: Trx, org: Org, address: string, list: SeededMail[], sent?: { at: Date; to: string[] }[]) =>
  seedSenderActivity(trx, org.ctx, org.mailboxId, { address, mails: list, ...(sent === undefined ? {} : { sent }) });

export const rowsOf = (trx: Trx, org: Org, mailboxId = org.mailboxId) =>
  trx
    .selectFrom("sender_suggestions")
    .selectAll()
    .where("mailbox_id", "=", mailboxId)
    .orderBy("created_at")
    .orderBy("kind")
    .orderBy("key_hash")
    .execute();

export const openOf = async (trx: Trx, org: Org, mailboxId = org.mailboxId) =>
  (await rowsOf(trx, org, mailboxId)).filter((row) => row.status === "open");

export const summary = (rows: { kind: string; scope: string; pattern: string | null; status: string }[]) =>
  rows.map((row) => `${row.status}:${row.kind}:${row.scope}:${row.pattern}`).sort();
