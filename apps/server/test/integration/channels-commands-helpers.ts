import { DAY_MS, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { type CommandDeps, type LinkedChat } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setDigestTimes } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";

// T is 11:00 in Warsaw (UTC+1 in November). The quota day (Los Angeles, UTC-8) started at 08:00Z = 09:00 local.
export const T = new Date("2026-11-06T10:00:00Z");
export const MIN = MINUTE_MS;
export const at = (offset: number) => new Date(T.getTime() + offset);
export const utc = (iso: string) => new Date(iso);

export function depsAt(trx: Transaction<DB>, now: Date, extra: Partial<CommandDeps> = {}): CommandDeps {
  return {
    db: trx,
    now: () => now,
    llmDailyCap: 300,
    triageScope: "all",
    actionsScope: { kind: "off" },
    llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
    hooks: noDelegationHooks,
    uidplus: async () => true,
    sendScope: { kind: "off" },
    testMail: NO_TEST_SENDERS,
    operatorContact: null,
    syncEveryMin: 2,
    ...extra,
  };
}

export async function llmCall(trx: Transaction<DB>, orgId: string, mailboxId: string, when: Date): Promise<void> {
  await recordAudit(
    trx,
    { orgId },
    { actor: "system", event: auditEvents.llmCall, data: { mailbox_id: mailboxId }, at: when }
  );
}

export async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const ctx = { orgId: a.orgId };
  await insertDefaultSettings(trx, ctx, a.mailboxId);
  await markSynced(trx, ctx, a.mailboxId, utc("2026-11-06T09:55:00Z"));
  await setDigestTimes(trx, ctx, a.userId, ["08:00", "16:00"]);
  const address = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", a.mailboxId)
    .executeTakeFirstOrThrow();
  const link: LinkedChat = {
    orgId: a.orgId,
    userId: a.userId,
    role: "owner",
    chatId: 1,
    linkedAt: at(-30 * DAY_MS),
    locale: "en",
  };
  return { a, ctx, link, address: address.address };
}
