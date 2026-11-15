import type { Category, UrgencySource } from "@ea/core";

import type { Db, TenantContext } from "../../../platform/db";
import { listEmailsByMessageIds, listSentMessageIds, normalizeMessageId } from "../../mail";
import { listLatestTriageByEmailIds } from "../../triage";
import type { LabCorpus } from "../corpus";
import type { LabEvent, LabRun } from "../state";

// One injected (or skipped) inbound slot joined to its stored mail and triage result. `truth` is the slot category.
// `skipped` is why the row has no prediction: `not_synced` (no mail row), `not_triaged` (a mail row, no result) or the
// code of the injector's `skip` event. Such a row is listed in counts and left out of precision and recall.
export interface ScoredMail {
  slotId: string;
  emailId: string | null;
  predicted: Category | null;
  truth: Category;
  urgencySource?: UrgencySource;
  hardCases: string[];
  lateBySec?: number;
  skipped?: string;
}

export interface SentCopies {
  appended: number;
  seen: number;
}

// The Message-ID the injector wrote for each slot, from its last `inject_done` event.
function injectedIds(events: readonly LabEvent[]): Map<string, { messageId: string; lateBySec?: number }> {
  const done = new Map<string, { messageId: string; lateBySec?: number }>();
  for (const event of events) {
    if (event.t !== "inject_done") continue;
    done.set(event.slotId, {
      messageId: event.messageId,
      ...(event.lateBySec === undefined ? {} : { lateBySec: event.lateBySec }),
    });
  }
  return done;
}

function skipCodes(events: readonly LabEvent[]): Map<string, string> {
  const skips = new Map<string, string>();
  for (const event of events) if (event.t === "skip") skips.set(event.ref, event.code);
  return skips;
}

/**
 * Joins each injected inbound slot of the run to the `emails` row of the run mailbox whose Message-ID header equals the
 * lab Message-ID (trimmed like the delegation finder does), and to the latest `triage_results` row of that mail. A
 * slot that the injector skipped keeps the skip code. Slots not injected yet and `sent` slots are not rows.
 * Every read filters by `ctx.orgId`.
 */
export async function joinRun(
  db: Db,
  ctx: TenantContext,
  run: LabRun,
  events: readonly LabEvent[],
  corpus: LabCorpus,
  mailboxId: string
): Promise<ScoredMail[]> {
  const injected = injectedIds(events);
  const skips = skipCodes(events);
  const inbound = run.plan.items.flatMap((item) => {
    const slot = corpus.slots.get(item.slotId);
    return slot === undefined || slot.direction === "sent" ? [] : [slot];
  });

  const ids = inbound.flatMap((slot) => {
    const messageId = normalizeMessageId(injected.get(slot.id)?.messageId);
    return messageId === null ? [] : [messageId];
  });
  const emails = await listEmailsByMessageIds(db, ctx, mailboxId, ids);
  // Two rows with one Message-ID: the lowest id first, so the choice is the same on every run.
  const byMessageId = new Map<string, string[]>();
  for (const email of [...emails].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = normalizeMessageId(email.message_id_header);
    if (key !== null) byMessageId.set(key, [...(byMessageId.get(key) ?? []), email.id]);
  }
  const triage = new Map(
    (
      await listLatestTriageByEmailIds(
        db,
        ctx,
        emails.map((email) => email.id)
      )
    ).map((row) => [row.email_id, row.category])
  );

  const rows: ScoredMail[] = [];
  for (const slot of inbound) {
    const done = injected.get(slot.id);
    const skip = skips.get(slot.id);
    const base = {
      slotId: slot.id,
      truth: slot.category,
      hardCases: [...slot.hardCases],
      ...(slot.urgencySource === undefined ? {} : { urgencySource: slot.urgencySource }),
      ...(done?.lateBySec === undefined ? {} : { lateBySec: done.lateBySec }),
    };
    if (done === undefined) {
      // No `inject_done`: a skipped slot is a row with its code; a slot not tried yet is not a row.
      if (skip !== undefined) rows.push({ ...base, emailId: null, predicted: null, skipped: skip });
      continue;
    }
    const candidates = byMessageId.get(normalizeMessageId(done.messageId) ?? "") ?? [];
    if (candidates.length === 0) {
      rows.push({ ...base, emailId: null, predicted: null, skipped: "not_synced" });
      continue;
    }
    // A copy that has a result wins over one that has none.
    const emailId = candidates.find((id) => triage.has(id)) ?? (candidates[0] as string);
    const predicted = triage.get(emailId) ?? null;
    rows.push(
      predicted === null
        ? { ...base, emailId, predicted: null, skipped: "not_triaged" }
        : { ...base, emailId, predicted }
    );
  }
  return rows;
}

/**
 * The `sent` slots (mail of the executive, APPENDed to Sent): how many the injector appended and how many the server
 * saw, that is, an `emails` row or a row in the Sent store with the lab Message-ID.
 */
export async function joinSentCopies(
  db: Db,
  ctx: TenantContext,
  run: LabRun,
  events: readonly LabEvent[],
  corpus: LabCorpus,
  mailboxId: string
): Promise<SentCopies> {
  const injected = injectedIds(events);
  const ids = run.plan.items.flatMap((item) => {
    if (corpus.slots.get(item.slotId)?.direction !== "sent") return [];
    const messageId = normalizeMessageId(injected.get(item.slotId)?.messageId);
    return messageId === null ? [] : [messageId];
  });
  const seenIds = new Set(
    (await listEmailsByMessageIds(db, ctx, mailboxId, ids)).map((email) => normalizeMessageId(email.message_id_header))
  );
  for (const stored of await listSentMessageIds(db, ctx, mailboxId, ids)) seenIds.add(normalizeMessageId(stored));
  return { appended: ids.length, seen: ids.filter((id) => seenIds.has(id)).length };
}
