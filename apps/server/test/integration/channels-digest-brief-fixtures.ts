import { HOUR_MS, DAY_MS } from "@ea/core";
import type { Insertable, Transaction } from "kysely";

import { scheduleDigests } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setDigestTimes } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { isolateChannels, linkChat, randomChatId, renderedOf } from "./fixtures";
import { consentRow, CURRENT_CONSENT } from "./follow-up-fixtures";
import { commandOrg, FRIDAY, type CommandOrg } from "./loops-commands-fixtures";
import { insertLoopRow } from "./loops-fixtures";

// Rows for the tests of the brief in the digest. The clock is Friday 2026-11-20 08:00 in Warsaw (07:00Z); the
// member is linked on 2026-11-05 and has the digest times 08:00 and 16:00.

export const LINKED = new Date("2026-11-05T20:00:00Z");
export const EIGHT = "2026-11-20T07:00:00Z";
export const SIXTEEN = "2026-11-20T15:00:00Z";
export { HOUR_MS as HOUR, DAY_MS as DAY } from "@ea/core";

export interface BriefOrg extends CommandOrg {
  chatId: number;
}

// An organization with the flag `open_loops`, the owner linked to a chat with consent to the loop terms.
export async function briefOrg(
  trx: Transaction<DB>,
  opts: { loopsFlag?: boolean; consent?: boolean } = {}
): Promise<BriefOrg> {
  const org = await commandOrg(trx, { loopsFlag: opts.loopsFlag });
  const chatId = randomChatId();
  await linkChat(trx, org.ctx, org.userId, chatId, LINKED);
  await setDigestTimes(trx, org.ctx, org.userId, ["08:00", "16:00"]);
  if (opts.consent !== false)
    await consentRow(trx, org.ctx.orgId, org.userId, CURRENT_CONSENT, new Date(LINKED.getTime() + HOUR_MS));
  return { ...org, chatId };
}

export async function runDigests(
  conn: Parameters<typeof scheduleDigests>[0]["db"],
  iso: string,
  webBaseUrl?: string
): Promise<void> {
  await scheduleDigests({
    db: conn,
    now: () => new Date(iso),
    testMail: NO_TEST_SENDERS,
    ...(webBaseUrl === undefined ? {} : { webBaseUrl }),
  });
}

// An open `waiting` loop that is overdue on Friday 2026-11-20 and shows in the brief.
export const waitingLoop = (
  conn: Transaction<DB>,
  org: CommandOrg,
  over: Partial<Insertable<DB["open_loops"]>> = {}
): Promise<string> =>
  insertLoopRow(conn, org.ctx, org.mailboxId, {
    counterpart: "anna@example.test",
    to_addresses: ["anna@example.test"],
    subject: "Offer for Q1",
    text: "send the offer",
    due_at: new Date("2026-11-19T09:00:00Z"),
    wait_from_at: new Date("2026-11-10T09:00:00Z"),
    ...over,
  });

// The text of every digest row of the organization, as the sender renders it, by dedup key.
export async function digestTexts(trx: Transaction<DB>, orgId: string): Promise<string[]> {
  const rows = await trx
    .selectFrom("outbox")
    .select(["kind", "view", "channel", "detail", "locale", "text", "buttons", "dedup_key"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "digest")
    .orderBy("dedup_key")
    .execute();
  return rows.map((row) => renderedOf(row).text);
}

export const loopRow = (trx: Transaction<DB>, id: string) =>
  trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

// The channels of other tests are switched off for the transaction, then the organization of the test is made.
export async function ready(trx: Transaction<DB>, opts: Parameters<typeof briefOrg>[1] = {}): Promise<BriefOrg> {
  await isolateChannels(trx);
  return briefOrg(trx, opts);
}

export { FRIDAY };
