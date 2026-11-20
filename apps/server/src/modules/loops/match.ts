import { normalizeAddress } from "@ea/core";
import { sql } from "kysely";

import { normalizedAddress, type TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { listMailboxes } from "../mail";

import { inTransaction } from "./analyze-rules";
import { expireFollowUpSends } from "./follow-up-expiry";
import { readReplyDecision } from "./reply-read";
import {
  closeLoop,
  type DbOrTrx,
  lockLoop,
  markAutoReply,
  toLoopRow,
  type LoopCloseReason,
  type LoopRow,
} from "./repo";

const log = createLog("loops");

// Open loops read per mailbox and run; the rest waits for the next run (oldest wait first).
const MAX_LOOPS = 500;

export interface MatchDeps {
  db: DbOrTrx;
}

export interface MatchResult {
  checked: number;
  replied: number;
  repliedSubject: number;
  dropped: number;
  autoMarked: number;
}

export const emptyMatchResult = (): MatchResult => ({
  checked: 0,
  replied: 0,
  repliedSubject: 0,
  dropped: 0,
  autoMarked: 0,
});

// The aliases that one mailbox read at most. A user has a few; the newest come first.
const MAX_ALIASES = 100;

// Every From address seen in the Sent rows of the mailbox, in the rule form (`normalizeAddress`): the user wrote from it, so a mail from it is not a
// reply (an alias that is not a mailbox address). A wrong entry can only hide a reply, never close a loop.
async function sentFromAddressesOf(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<string[]> {
  const { rows } = await sql<{ address: string }>`
    SELECT ${normalizedAddress("from_address")} AS address
    FROM sent_emails
    WHERE org_id = ${ctx.orgId} AND mailbox_id = ${mailboxId} AND from_address IS NOT NULL AND from_address <> ''
    GROUP BY ${normalizedAddress("from_address")}
    ORDER BY max(sent_at) DESC, ${normalizedAddress("from_address")}
    LIMIT ${MAX_ALIASES}
  `.execute(db);
  return rows.map((row) => row.address.trim());
}

// The own addresses of one mailbox, in two parts: every mailbox address of the organization, and the From addresses of the
// Sent rows of this mailbox (aliases). Rule form.
export interface OwnAddressSets {
  mailboxes: string[];
  aliases: string[];
}

export async function ownAddressSetsOf(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<OwnAddressSets> {
  const mailboxes = (await listMailboxes(db, ctx)).map((mailbox) => normalizeAddress(mailbox.address));
  return { mailboxes, aliases: await sentFromAddressesOf(db, ctx, mailboxId) };
}

// The own addresses for the reply rules of one loop: the mailbox addresses, and the aliases except the people of the loop.
// A person that the user wrote to (the counterpart, To, Cc) and who also appears as a From of the Sent rows (send-as or
// delegate access to the mailbox) still counts as a stranger when they write: their reply closes the loop.
export function ownAddressesFor(
  sets: OwnAddressSets,
  loop: Pick<LoopRow, "to_addresses" | "cc_addresses" | "counterpart">
): string[] {
  const people = new Set(
    [...loop.to_addresses, ...loop.cc_addresses, ...(loop.counterpart === null ? [] : [loop.counterpart])].map(
      normalizeAddress
    )
  );
  return [...new Set([...sets.mailboxes, ...sets.aliases.filter((alias) => !people.has(alias))])];
}

async function openWaitingLoops(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<LoopRow[]> {
  const rows = await db
    .selectFrom("open_loops")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "open")
    .where("kind", "in", ["waiting", "delegated"])
    .orderBy("wait_from_at")
    .orderBy("id")
    .limit(MAX_LOOPS)
    .execute();
  return rows.map(toLoopRow);
}

interface Outcome {
  closed: "replied" | "replied_subject" | "dropped" | null;
  // This call set `auto_reply_at`.
  auto: boolean;
}

const NOTHING: Outcome = { closed: null, auto: false };

// One loop, in one transaction: lock it, check that it is still open, decide again on the locked row and write. A close
// and the end of its waiting follow-up sends are one commit. Two runs at once: the second finds the loop closed. An
// automatic answer before the first real reply sets `auto_reply_at` once; the search goes on past it.
async function applyToLoop(
  db: DbOrTrx,
  ctx: TenantContext,
  loopId: string,
  ownSets: OwnAddressSets,
  now: Date
): Promise<Outcome> {
  return inTransaction(db, async (trx): Promise<Outcome> => {
    const loop = await lockLoop(trx, ctx, loopId);
    if (loop === undefined || loop.status !== "open" || loop.kind === "promised") return NOTHING;
    const close = async (reason: LoopCloseReason, emailId?: string): Promise<boolean> => {
      if ((await closeLoop(trx, ctx, { loopId, reason, emailId, at: now })) !== "closed") return false;
      await expireFollowUpSends(trx, ctx, { mailboxId: loop.mailbox_id, loopId }, now);
      return true;
    };
    // A DSR erase emptied the recipients: nobody is left to wait for.
    if (loop.to_addresses.length === 0) return { closed: (await close("dropped")) ? "dropped" : null, auto: false };
    const decision = await readReplyDecision(trx, ctx, loop, ownAddressesFor(ownSets, loop));
    const auto = decision.auto && loop.auto_reply_at === null && (await markAutoReply(trx, ctx, { loopId, at: now }));
    if (decision.first === null) return { closed: null, auto };
    const reason = decision.first.kind === "thread" ? "replied" : "replied_subject";
    return { closed: (await close(reason, decision.first.emailId)) ? reason : null, auto };
  });
}

// The close rules for the open `waiting` and `delegated` loops of one mailbox. `now` is the time written.
export async function matchReplies(
  deps: MatchDeps,
  ctx: TenantContext,
  mailboxId: string,
  input: { now: Date }
): Promise<MatchResult> {
  const result = emptyMatchResult();
  const loops = await openWaitingLoops(deps.db, ctx, mailboxId);
  if (loops.length === 0) return result;
  const own = await ownAddressSetsOf(deps.db, ctx, mailboxId);
  for (const loop of loops) {
    result.checked += 1;
    // The cheap read first, without a lock: most loops have no mail to act on.
    const decision =
      loop.to_addresses.length === 0 ? null : await readReplyDecision(deps.db, ctx, loop, ownAddressesFor(own, loop));
    const worthALock = decision === null || decision.first !== null || (decision.auto && loop.auto_reply_at === null);
    if (!worthALock) continue;
    const outcome = await applyToLoop(deps.db, ctx, loop.id, own, input.now);
    if (outcome.closed === "replied") result.replied += 1;
    else if (outcome.closed === "replied_subject") result.repliedSubject += 1;
    else if (outcome.closed === "dropped") result.dropped += 1;
    if (outcome.auto) result.autoMarked += 1;
  }
  const lines: [string, number][] = [
    ["replied", result.replied],
    ["replied_subject", result.repliedSubject],
    ["dropped", result.dropped],
    ["auto", result.autoMarked],
  ];
  for (const [kind, count] of lines) {
    if (count > 0) log.with({ org_id: ctx.orgId, mailbox_id: mailboxId }).info("loops_matched", { count, kind });
  }
  return result;
}
