import { cleanUserText, defaultDue } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { type ContactWait, contactWaitFor } from "../contacts";

import { type SentCandidate, writeAnalysis } from "./analysis-repo";
import { type MailboxEnv, inTransaction, lockSentTracking } from "./analyze-rules";
import type { Extraction } from "./extractor";
import { type DbOrTrx, insertLoop, type NewLoop } from "./repo";

const SUBJECT_MAX = 300;

const log = createLog("loops");

// One line of at most 300 characters; null when nothing is left. The subject is the header of a mail that goes out
// again in a follow-up: it never holds a line break.
export function loopSubject(subject: string | null): string | null {
  if (subject === null) return null;
  const line = cleanUserText(subject, { oneLine: true });
  const cut = [...line].slice(0, SUBJECT_MAX).join("").trim();
  return cut === "" ? null : cut;
}

export type WriteOutcome =
  // The analysis row is `done`; `opened` loops were inserted (a repeat inserts none).
  | { kind: "written"; opened: number }
  // The row was not `pending` any more: another run finished it.
  | { kind: "exists" }
  | { kind: "off" };

// The usual reply time of one contact (`contactWaitFor` with its dependencies bound), or null.
export type ContactWaitReader = (counterpart: string) => Promise<ContactWait | null>;

// The counterpart whose wait the answer needs, or null: no ask, or a stated date (it always wins).
export function counterpartOf(row: SentCandidate, extraction: Extraction, env: MailboxEnv): string | null {
  if (!extraction.expectsReply || extraction.due !== null) return null;
  return askOf(row, env).counterpart;
}

// The address that the ask is about: the delegate that owns a To address, else the first To, else the first Cc.
function askOf(
  row: SentCandidate,
  env: MailboxEnv
): { counterpart: string | null; delegate: MailboxEnv["delegates"][number] | undefined } {
  const to = row.to.map((address) => address.toLowerCase());
  const delegate = to
    .map((address) => ({ address, delegate: env.delegates.find((candidate) => candidate.email === address) }))
    .find((match) => match.delegate !== undefined);
  const first = to[0] ?? row.cc[0]?.toLowerCase() ?? null;
  return { counterpart: delegate?.address ?? first, delegate: delegate?.delegate };
}

// The loops that one answer opens. Every address, the subject and the message ids come from the Sent row, never from
// the model. A mail with an ask and a promise opens two loops. `contact`: the wait of the counterpart of the ask
// (`counterpartOf`), read by the caller.
export function loopsOf(
  row: SentCandidate,
  extraction: Extraction,
  env: MailboxEnv,
  contact: ContactWait | null = null
): { loops: NewLoop[]; hasPromise: boolean } {
  const base = {
    mailboxId: env.mailboxId,
    sentEmailId: row.id,
    threadKey: row.threadKey,
    messageId: row.messageId,
    referencesIds: row.referencesIds,
    subject: loopSubject(row.subject),
    toAddresses: row.to,
    ccAddresses: row.cc,
    language: extraction.language === "pl" ? ("pl" as const) : ("en" as const),
    waitFromAt: row.sentAt,
    at: env.now,
  };
  const first = row.to[0]?.toLowerCase() ?? row.cc[0]?.toLowerCase() ?? null;
  const loops: NewLoop[] = [];
  if (extraction.expectsReply) {
    // The first To address that an active delegate owns: a hand forward to the delegate.
    const { counterpart, delegate } = askOf(row, env);
    const stated = extraction.due !== null;
    // A stated date always wins; then the usual reply time of the contact; then the wait of the owner.
    const use = !stated && contact !== null;
    loops.push({
      ...base,
      kind: delegate === undefined ? "waiting" : "delegated",
      counterpart,
      delegateId: delegate?.id ?? null,
      text: extraction.ask,
      dueAt: extraction.due ?? defaultDue(row.sentAt, use ? contact.waitDays : env.waitDays, env.timeZone),
      dueSource: stated ? "stated" : use ? "contact" : "default",
      usualReplyDays: use ? contact.usualReplyDays : null,
    });
  }
  // An undated promise opens nothing.
  const hasPromise = extraction.promise !== null && extraction.promiseDue !== null;
  if (hasPromise && extraction.promiseDue !== null) {
    loops.push({
      ...base,
      kind: "promised",
      counterpart: first,
      delegateId: null,
      text: extraction.promise,
      dueAt: extraction.promiseDue,
      dueSource: "stated",
      usualReplyDays: null,
    });
  }
  return { loops, hasPromise };
}

// The wait of the contact that the new `waiting` or `delegated` loop is about. A plain read of a derived table, done before
// the write transaction (no lock order changes); a profile that changes before the write is accepted. A failed read gives
// null: the loop gets the default wait.
async function readContactWait(
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate,
  extraction: Extraction,
  read: ContactWaitReader | undefined
): Promise<ContactWait | null> {
  const counterpart = counterpartOf(row, extraction, env);
  if (read === undefined || counterpart === null) return null;
  try {
    return await read(counterpart);
  } catch (error) {
    // No address in the log: the error name and code only.
    log.with({ org_id: ctx.orgId, mailbox_id: env.mailboxId }).warn("contact_wait_failed", errorFields(error));
    return null;
  }
}

// One transaction: the analysis row and the loops. A crash before the commit writes nothing, so a repeat costs a call
// and no loop; the unique key makes a repeat after the commit an `exists`.
export async function writeExtraction(
  db: DbOrTrx,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate,
  extraction: Extraction,
  promptVersion: string,
  contactWait?: ContactWaitReader
): Promise<WriteOutcome> {
  // The read of the contact wait runs before the transaction: no lock order changes.
  const contact = await readContactWait(ctx, env, row, extraction, contactWait);
  return inTransaction(db, async (trx) => {
    if (!(await lockSentTracking(trx, ctx, env.mailboxId))) return { kind: "off" };
    const { loops, hasPromise } = loopsOf(row, extraction, env, contact);
    const wrote = await writeAnalysis(trx, ctx, {
      mailboxId: env.mailboxId,
      sentEmailId: row.id,
      write: { status: "done", expectsReply: extraction.expectsReply, hasPromise, promptVersion },
      at: env.now,
    });
    if (!wrote) return { kind: "exists" };
    let opened = 0;
    for (const loop of loops) {
      if ("id" in (await insertLoop(trx, ctx, loop))) opened += 1;
    }
    return { kind: "written", opened };
  });
}
