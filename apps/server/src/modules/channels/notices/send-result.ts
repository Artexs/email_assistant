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
import { type LinkedChat } from "../port";

import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

const SEND_KINDS: readonly DraftKind[] = draftKinds;
const EXPIRY_REASONS = [
  "timeout",
  "draft_missing",
  "not_notified",
  "not_seen",
  "held_timeout",
  "delegation_closed",
  "policy_changed",
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
      return { kind: "sent", sentCopy: copy === "appended" || copy === "found" ? copy : "failed", draftRemoved };
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

// D20: every end state of a send gives one notice per owner. A pending Sent copy counts as lost after 10 minutes.
async function detectSendResults(db: DbOrTrx, ctx: TenantContext, owners: LinkedChat[], now: Date): Promise<void> {
  if (owners.length === 0) return;
  const rows = await listSendResultsToNotify(db, ctx, {
    limit: APPROVAL_LIMIT,
    now,
    pendingCopyMaxAgeMs: SENT_COPY_PENDING_MAX_AGE_MS,
  });
  if (rows.length === 0) return;
  // One flag read for the run; the button shows only on a `sent` result (plan D21).
  const mistakeButton = await isFeatureOn(db, ctx, "mistake_capture");
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
      const view = {
        actionId: row.id,
        sendKind,
        result,
        recipient: { name: stringOf(draftRow?.payload.delegate_name), address: to ?? draftTo },
        subject: outgoingSubject(sendKind, row.email.subject),
        synthetic: isSyntheticMessageId(row.email.message_id_header),
        ...(mistakeButton && result.kind === "sent" ? { mistakeButton: true } : {}),
      };
      await inTransaction(db, async (trx) => {
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "send_result",
              dedupKey: `send_result:${row.id}`,
              emailId: row.email_id,
              view,
            },
            now
          );
        }
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
  detect: (run) => detectSendResults(run.db, run.ctx, run.owners, run.now),
};
