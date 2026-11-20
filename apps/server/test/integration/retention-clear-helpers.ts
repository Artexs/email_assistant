import { DAY_MS } from "@ea/core";
import { type Transaction } from "kysely";

import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

export const now = new Date("2026-11-12T03:00:00Z");
export const ago = (ms: number): Date => new Date(now.getTime() - ms);
export const before30 = ago(30 * DAY_MS);
export const before90 = ago(90 * DAY_MS);
export const pendingBefore = ago(7 * DAY_MS);
export const over30 = ago(30 * DAY_MS + 1000);
export const over90 = ago(90 * DAY_MS + 1000);

export interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

export async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}
