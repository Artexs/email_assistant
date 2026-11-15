import { cleanUserText, defaultDue } from "@ea/core";

import type { TenantContext } from "../../platform/db";

import { type SentCandidate, writeAnalysis } from "./analysis-repo";
import { type MailboxEnv, inTransaction, lockSentTracking } from "./analyze-rules";
import type { Extraction } from "./extractor";
import { type DbOrTrx, insertLoop, type NewLoop } from "./repo";

const SUBJECT_MAX = 300;

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

// The loops that one answer opens. Every address, the subject and the message ids come from the Sent row, never from
// the model. A mail with an ask and a promise opens two loops.
export function loopsOf(
  row: SentCandidate,
  extraction: Extraction,
  env: MailboxEnv
): { loops: NewLoop[]; hasPromise: boolean } {
  const to = row.to.map((address) => address.toLowerCase());
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
  const first = to[0] ?? row.cc[0]?.toLowerCase() ?? null;
  const loops: NewLoop[] = [];
  if (extraction.expectsReply) {
    // The first To address that an active delegate owns: a hand forward to the delegate.
    const delegate = to
      .map((address) => ({ address, delegate: env.delegates.find((candidate) => candidate.email === address) }))
      .find((match) => match.delegate !== undefined);
    const stated = extraction.due !== null;
    loops.push({
      ...base,
      kind: delegate === undefined ? "waiting" : "delegated",
      counterpart: delegate?.address ?? first,
      delegateId: delegate?.delegate?.id ?? null,
      text: extraction.ask,
      dueAt: extraction.due ?? defaultDue(row.sentAt, env.waitDays, env.timeZone),
      dueSource: stated ? "stated" : "default",
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
    });
  }
  return { loops, hasPromise };
}

// One transaction: the analysis row and the loops. A crash before the commit writes nothing, so a repeat costs a call
// and no loop; the unique key makes a repeat after the commit an `exists`.
export async function writeExtraction(
  db: DbOrTrx,
  ctx: TenantContext,
  env: MailboxEnv,
  row: SentCandidate,
  extraction: Extraction,
  promptVersion: string
): Promise<WriteOutcome> {
  return inTransaction(db, async (trx) => {
    if (!(await lockSentTracking(trx, ctx, env.mailboxId))) return { kind: "off" };
    const { loops, hasPromise } = loopsOf(row, extraction, env);
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
