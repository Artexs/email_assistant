import { createLog } from "../../platform/log";
import type { MailProvider } from "../mail";

import type { ApplyDeps } from "./apply-shared";
import { baselineOf, judgeCopy, readDraftCopy } from "./copy";
import type { ClaimedAction, DraftRow } from "./repo";

const log = createLog("actions");

// What the check before the SMTP call decided. `close`: the send ends `expired` with this reason and nothing is sent.
// `error`: the read of the Drafts folder failed; the caller maps the error to a retry (the send has not started).
export type CopyGate =
  | { kind: "continue" }
  | { kind: "close"; reason: "draft_changed" | "draft_missing" }
  | { kind: "error"; error: unknown };

// A reply always checks. Another kind checks only while the org flag `draft_copy_check` is on (`ApplyDeps.copyCheck`).
export function mustCheckCopy(deps: Pick<ApplyDeps, "copyCheck">, sendKind: string): boolean {
  return sendKind === "reply" || deps.copyCheck === true;
}

/**
 * The edit check of the first try of an `approved` send (an `applying` send in recovery searches Sent, as before). It reads
 * the Drafts copy of the send's draft once and compares it with the baseline hash that the draft row holds:
 * - same hash: `continue`;
 * - another hash, or a text that cannot be read: `draft_changed`, the copy stays;
 * - no copy in the folder: `draft_missing`;
 * - no baseline (an older draft, or the read after the APPEND failed): a reply never sends (`draft_missing`, the copy stays,
 *   no IMAP read needed); another kind goes on as before.
 * One `reply_send_checked` line per check. The text of the copy is never logged or stored. Writes nothing to the mailbox.
 */
export async function checkCopyBeforeSend(
  deps: Pick<ApplyDeps, "folders">,
  action: ClaimedAction,
  provider: MailProvider,
  draft: DraftRow,
  sendKind: string
): Promise<CopyGate> {
  const baseline = baselineOf(draft.provider_result);
  if (baseline === null) {
    log.info("reply_send_checked", { action_id: action.id, result: "no_baseline" });
    return sendKind === "reply" ? { kind: "close", reason: "draft_missing" } : { kind: "continue" };
  }
  try {
    const stored = draft.provider_result?.folder;
    const folder = typeof stored === "string" ? stored : await deps.folders.resolve("drafts");
    const uid = draft.provider_result?.uid;
    const read = await readDraftCopy(provider, folder, {
      actionId: draft.id,
      hintUid: typeof uid === "number" ? uid : null,
      since: draft.created_at,
    });
    const result = judgeCopy(read, baseline);
    log.info("reply_send_checked", { action_id: action.id, result });
    if (result === "same") return { kind: "continue" };
    return { kind: "close", reason: result === "missing" ? "draft_missing" : "draft_changed" };
  } catch (error) {
    return { kind: "error", error };
  }
}
