import { normalizeSenderAddress, type SenderHistory, type SenderLine } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import { PROFILE_DAYS } from "./activity";
import { senderFlags } from "./flags";
import { readProfiles } from "./profiles";

type DbOrTrx = Db | Transaction<DB>;
type Reader = typeof readProfiles;

export interface SenderLineDeps {
  db: DbOrTrx;
  // `CREDENTIALS_KEY`: the key of `senderKeyHash`. It never leaves the server.
  credentialsKey: string;
  // The profile reader. A test passes a spy to count the calls; the default is `readProfiles`.
  readProfiles?: Reader;
}

// The mail of a page item: its mailbox and the stored From address (null when retention cleared it).
export interface SenderMail {
  mailboxId: string;
  address: string | null;
}

// The counts of the sender line: the part of the profile that the panel shows (no address, no hash).
export function senderLineOf(history: SenderHistory): SenderLine {
  return {
    relation: history.relation,
    received: history.received,
    answered: history.answered,
    userMailsTo: history.userMailsTo,
    lastSeenDaysAgo: history.lastSeenDaysAgo,
    days: PROFILE_DAYS,
  };
}

// The sender lines of one page, in the order of `mails`, with ONE profile read for all of them (the page can span mailboxes).
// `null`: the flag `sender_context` is off (the caller leaves the key out of its answer). Otherwise one entry for each mail, null
// when the mail has no address (cleared by retention) or its sender has no profile row in the mail's mailbox.
// A page with no address makes no profile read.
export async function readSenderLines(
  deps: SenderLineDeps,
  ctx: TenantContext,
  mails: readonly SenderMail[],
  now: Date
): Promise<(SenderLine | null)[] | null> {
  if (!(await senderFlags(deps.db, ctx)).context) return null;
  const pairs = new Map<string, { mailboxId: string; address: string }>();
  for (const mail of mails) {
    if (mail.address === null) continue;
    const address = normalizeSenderAddress(mail.address);
    if (address === "") continue;
    pairs.set(`${mail.mailboxId}:${address}`, { mailboxId: mail.mailboxId, address });
  }
  if (pairs.size === 0) return mails.map(() => null);
  const read = deps.readProfiles ?? readProfiles;
  const profiles = await read({ db: deps.db, credentialsKey: deps.credentialsKey }, ctx, [...pairs.values()], now);
  return mails.map((mail) => {
    if (mail.address === null) return null;
    const history = profiles.get(`${mail.mailboxId}:${normalizeSenderAddress(mail.address)}`);
    return history === undefined ? null : senderLineOf(history);
  });
}
