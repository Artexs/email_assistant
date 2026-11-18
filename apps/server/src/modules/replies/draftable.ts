import { parseToolSwitches, replyEligibility } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { listOpenReplyEmailIds } from "../actions";
import { getMailboxSettings } from "../config";
import { getMailbox } from "../mail";
import { isFeatureOn } from "../tenancy";

import { loadReplyFacts } from "./facts";

// The mails (of `emailIds`) that get a "Draft reply" button: a reply draft can be made for them now (the rules of a tap: the mail is
// checked, from a person, not suspicious, not answered, not a calendar invitation) and none is open yet. The mail is in the category
// `needs_reply` or `urgent`, the flag is on, and the mailbox is a password mailbox in `assist` with the reply switch on. The button is
// a hint: the tap checks every rule again.
export async function draftableMails(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  emailIds: readonly string[],
  opts: { now: Date }
): Promise<Set<string>> {
  const found = new Set<string>();
  if (emailIds.length === 0 || !(await isFeatureOn(db, ctx, "reply_drafts"))) return found;
  const loaded = await loadReplyFacts(db, ctx, emailIds, { ownerLocale: null });
  const candidates = [...loaded].filter(
    ([, entry]) => entry.facts.category === "needs_reply" || entry.facts.category === "urgent"
  );
  if (candidates.length === 0) return found;
  const open = await listOpenReplyEmailIds(
    db,
    ctx,
    candidates.map(([emailId]) => emailId)
  );
  const mailboxOk = new Map<string, boolean>();
  for (const [emailId, entry] of candidates) {
    if (open.has(emailId) || !replyEligibility(entry.facts, { trigger: "tap", now: opts.now }).ok) continue;
    const { mailboxId } = entry.mail;
    if (!mailboxOk.has(mailboxId)) {
      const mailbox = await getMailbox(db, ctx, mailboxId);
      const settings = await getMailboxSettings(db, ctx, mailboxId);
      mailboxOk.set(
        mailboxId,
        mailbox !== undefined &&
          mailbox.oauth_provider === null &&
          settings?.mode === "assist" &&
          parseToolSwitches(settings.tool_switches).reply_drafts
      );
    }
    if (mailboxOk.get(mailboxId) === true) found.add(emailId);
  }
  return found;
}
