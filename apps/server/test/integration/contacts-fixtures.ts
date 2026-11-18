import { randomUUID } from "node:crypto";

import type { Transaction } from "kysely";

import { refreshMailboxProfiles, type RefreshDeps } from "../../src/modules/contacts";
import { insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { senderKeyHash } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, testCapabilities, type SeededMail } from "./fixtures";

// Helpers of the profile pass tests (`contacts-refresh.test.ts`, `contacts-refresh-guards.test.ts`). The clock is fixed and the
// key is a test key, so no test needs `CREDENTIALS_KEY` in the environment.
export type Trx = Transaction<DB>;

export const NOW = new Date("2026-11-18T10:00:00Z");
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const KEY = Buffer.alloc(32, 7).toString("base64");
export const NO_TEST = { senders: [] as string[] };

export const ago = (days: number, hours = 0): Date => new Date(NOW.getTime() - days * DAY - hours * HOUR);
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
