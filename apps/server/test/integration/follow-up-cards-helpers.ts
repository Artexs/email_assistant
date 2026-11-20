import { MINUTE_MS, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { detectNotices } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { CURRENT_CONSENT, consentRow, OLD_CONSENT } from "./follow-up-fixtures";

export const T = new Date("2026-11-20T10:00:00Z");
export const at = (ms: number) => new Date(T.getTime() + ms);

export interface World {
  ctx: TenantContext;
  orgId: string;
  mailboxId: string;
  owner: string; // consent covers loop data
  owner2: string; // consent covers loop data
  oldOwner: string; // an old consent
  noConsentOwner: string; // linked by the CLI: no consent row
  member: string; // an assistant
}

// Four owners and an assistant, each with a chat. Loop data may go to `owner` and `owner2` only.
export async function world(trx: Transaction<DB>): Promise<World> {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-HOUR_MS) })
    .where("id", "=", created.mailboxId)
    .execute();
  const owner2 = await addMember(trx, created.orgId, "owner");
  const oldOwner = await addMember(trx, created.orgId, "owner");
  const noConsentOwner = await addMember(trx, created.orgId, "owner");
  const member = await addMember(trx, created.orgId, "assistant");
  for (const user of [created.userId, owner2, oldOwner, noConsentOwner, member]) {
    await linkChat(trx, ctx, user, randomChatId(), at(-2 * HOUR_MS));
  }
  await consentRow(trx, created.orgId, created.userId, CURRENT_CONSENT, at(-HOUR_MS));
  await consentRow(trx, created.orgId, owner2, CURRENT_CONSENT, at(-HOUR_MS));
  await consentRow(trx, created.orgId, oldOwner, OLD_CONSENT, at(-HOUR_MS));
  await consentRow(trx, created.orgId, member, CURRENT_CONSENT, at(-HOUR_MS));
  await setOrgFeature(trx, ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: T });
  return {
    ctx,
    orgId: created.orgId,
    mailboxId: created.mailboxId,
    owner: created.userId,
    owner2,
    oldOwner,
    noConsentOwner,
    member,
  };
}

// `null`: no panel base URL (no link on any line).
export async function run(
  trx: Transaction<DB>,
  webBaseUrl: string | null = "https://panel.example.test"
): Promise<void> {
  await detectNotices({
    db: trx,
    now: () => T,
    startedAt: at(-HOUR_MS),
    testMail: NO_TEST_SENDERS,
    ...(webBaseUrl === null ? {} : { webBaseUrl }),
  });
}

export async function outbox(trx: Transaction<DB>, orgId: string, kind?: string) {
  let query = trx
    .selectFrom("outbox")
    .select([
      "id",
      "user_id",
      "kind",
      "dedup_key",
      "text",
      "buttons",
      "view",
      "locale",
      "status",
      "email_id",
      "loop_id",
      "channel",
      "detail",
    ])
    .where("org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  return (await query.execute()).map((row) => ({ ...row, ...renderedOf(row) }));
}

export const users = (rows: { user_id: string }[]) => rows.map((row) => row.user_id).sort();
