import { draftKinds, type DraftKind, outgoingSubject, type SendResultKind } from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import {
  draftHasReverse,
  getDraft,
  listSendResultsToNotify,
  markResultNotified,
  SENT_COPY_PENDING_MAX_AGE_MS,
  SOFT_CAP_MARK,
  type SendRow,
} from "../../actions";
import { auditEvents, findActionActor } from "../../audit";
import { isSyntheticMessageId } from "../../mail";
import { isFeatureOn, listMemberships } from "../../tenancy";
import { type NoticeRecipient } from "../notice-fan-out";

import { panelListUrlOf } from "./approval";
import { queueLoopConsentLines, splitByLoopConsent, type LoopGate } from "./loop-consent";
import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

const SEND_KINDS: readonly DraftKind[] = draftKinds;
export const EXPIRY_REASONS = [
  "timeout",
  "draft_missing",
  "not_notified",
  "not_seen",
  "held_timeout",
  "delegation_closed",
  "policy_changed",
  "loop_closed",
  "draft_changed",
  // The reasons that only a reply send has.
  "answered",
  "sent_by_user",
  "newer_mail",
  "original_moved",
  "suspicious",
] as const;

function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

async function resultKindOf(
  db: DbOrTrx,
  ctx: TenantContext,
  row: SendRow,
  draftRemoved: boolean,
  names: ReadonlyMap<string, string>
): Promise<SendResultKind> {
  const result = row.provider_result ?? {};
  switch (row.status) {
    case "applied": {
      const copy = result.sent_copy;
      // A copy still `pending` here is older than the wait: the copy step died.
      // `provider`: the provider saves the copy itself (Graph), so the person sees it as found.
      const sentCopy = copy === "provider" ? "found" : copy === "appended" || copy === "found" ? copy : "failed";
      return { kind: "sent", sentCopy, draftRemoved };
    }
    case "failed": {
      const stage = stringOf(result.stage);
      const code = numberOf(result.response_code) ?? stringOf(result.code);
      switch (row.status_reason) {
        case "smtp_rejected":
          return {
            kind: "rejected_by_server",
            stage: stage ?? "unknown",
            responseCode: numberOf(result.response_code),
          };
        case "outcome_unknown":
          return { kind: "outcome_unknown" };
        case "bad_payload":
          return { kind: "failed", cause: "bad_payload", code: null, tries: row.attempts };
        // A reply with a gap never went out (the tap refuses such a text, so a hand edit of the database made it).
        case "has_gaps":
          return { kind: "failed", cause: "has_gaps", code: null, tries: row.attempts };
        // The Drafts copy could not be read before the send (an IMAP error): nothing went out, and "Send again" is offered.
        case "copy_check_error":
          return {
            kind: "failed",
            cause: "copy_check",
            code: code === null ? null : String(code),
            tries: row.attempts,
          };
        default: {
          const cause =
            result.cap === SOFT_CAP_MARK
              ? "soft_cap"
              : stage === "content"
                ? "content_soft"
                : stage === "compose"
                  ? "compose"
                  : "tries";
          return { kind: "failed", cause, code: code === null ? null : String(code), tries: row.attempts };
        }
      }
    }
    case "expired": {
      const reason = EXPIRY_REASONS.find((known) => known === row.status_reason);
      if (reason === undefined) throw new Error("unknown expiry reason");
      return { kind: "expired", reason, draftRemoved };
    }
    default: {
      const actor = await findActionActor(db, ctx, row.id, auditEvents.actionRejected);
      return { kind: "rejected", byName: actor === undefined ? null : (names.get(actor) ?? null), draftRemoved };
    }
  }
}

// Every end state of a send gives one notice per owner. A pending Sent copy counts as lost after 10 minutes.
async function detectSendResults(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: NoticeRecipient[],
  now: Date,
  webBaseUrl: string | undefined
): Promise<void> {
  if (owners.length === 0) return;
  const rows = await listSendResultsToNotify(db, ctx, {
    limit: APPROVAL_LIMIT,
    now,
    pendingCopyMaxAgeMs: SENT_COPY_PENDING_MAX_AGE_MS,
  });
  if (rows.length === 0) return;
  // One flag read for the run; the button shows only on a `sent` result.
  const mistakeButton = await isFeatureOn(db, ctx, "mistake_capture");
  // The panel link of the consent line, as on the approval card: only when the panel page is on and the base URL is set.
  const panelBase = webBaseUrl !== undefined && (await isFeatureOn(db, ctx, "approvals_page")) ? webBaseUrl : undefined;
  const names = new Map((await listMemberships(db, ctx)).map((member) => [member.user_id, member.display_name]));
  for (const row of rows) {
    try {
      const draftRow =
        row.depends_on_action_id === null ? undefined : await getDraft(db, ctx, row.depends_on_action_id);
      const draftRemoved = draftRow !== undefined && (await draftHasReverse(db, ctx, draftRow.id));
      const sendKind = SEND_KINDS.find((known) => known === row.payload.kind) ?? "delegation";
      const to = Array.isArray(row.payload.to) ? stringOf(row.payload.to[0]) : null;
      const draftTo = Array.isArray(draftRow?.payload.to) ? stringOf(draftRow.payload.to[0]) : null;
      const result = await resultKindOf(db, ctx, row, draftRemoved, names);
      // A follow-up result names its first recipient (a sent mail): the consent gate splits the owners.
      // The result is the change of the send row.
      const eventAt = row.updated_at;
      const gate: LoopGate =
        row.loop_id === null
          ? { covered: owners, withheld: [], pushWithheld: [] }
          : await splitByLoopConsent(db, ctx, owners, { kind: "send_result", eventAt, now });
      const view = {
        actionId: row.id,
        sendKind,
        result,
        recipient: { name: stringOf(draftRow?.payload.delegate_name), address: to ?? draftTo },
        subject: outgoingSubject(
          sendKind,
          row.email === null ? stringOf(draftRow?.payload.subject) : row.email.subject
        ),
        synthetic: row.email !== null && isSyntheticMessageId(row.email.message_id_header),
        ...(mistakeButton && result.kind === "sent" ? { mistakeButton: true } : {}),
      };
      await inTransaction(db, async (trx) => {
        const queueFor = (owner: NoticeRecipient, only?: "push") =>
          queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "send_result",
              dedupKey: `send_result:${row.id}`,
              ...(row.email_id === null ? {} : { emailId: row.email_id }),
              ...(row.loop_id === null ? {} : { loopId: row.loop_id }),
              eventAt,
              ...(only === undefined ? {} : { only }),
              view,
            },
            now
          );
        for (const owner of gate.covered) await queueFor(owner);
        for (const owner of gate.pushWithheld) await queueFor(owner, "push");
        await queueLoopConsentLines(trx, ctx, gate.withheld, {
          about: "result",
          panelUrl: panelBase === undefined ? undefined : panelListUrlOf(panelBase),
          now,
        });
        await markResultNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      warnSkipped("send_result", row.id, error);
    }
  }
}

export const sendResultDetector: Detector = {
  name: "send-result",
  kinds: ["send_result"],
  detect: (run) => detectSendResults(run.db, run.ctx, run.owners, run.now, run.deps.webBaseUrl),
};
