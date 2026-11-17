import {
  delegateListSchema,
  delegateMailAnswerSchema,
  NEEDS_ACTION_CATEGORIES,
  settingsViewSchema,
  type ActivityItem,
  type DelegateMailAnswer,
  type Delegate,
  type MailboxView,
  type Me,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { api, ApiError } from "./api";
import { canWrite } from "./can-write";
import { errorText } from "./errors";
import { settingsPath } from "./settings-api";

// The Delegate action on a mail row of the Activity page (F116 stage 22, PD-124). The action is a hint: the server checks every
// rule again when the owner picks a delegate (`POST /emails/:id/delegate`), and a refusal has its own text.

// What the page knows once: the active delegates of the organization and the mailboxes in assist mode with drafts on.
export interface DelegateHint {
  delegates: readonly Delegate[];
  draftMailboxIds: ReadonlySet<string>;
}

// The organization part of the rule: an owner of an organization that is not suspended, with the flag `delegate_button` on and the
// flag `delegation_pages` on (`GET /delegates` is a 404 without it: the list of delegates is the page of the delegates).
export function delegateHintWanted(me: Pick<Me, "role" | "organization" | "features"> | null): boolean {
  return (
    me !== null &&
    me.role === "owner" &&
    canWrite(me) &&
    me.features.includes("delegate_button") &&
    me.features.includes("delegation_pages")
  );
}

const OPEN_DELEGATION = new Set(["drafted", "sent", "overdue"]);

// The row part of the rule: a category of the Telegram rule (urgent, needs reply, unsure), no suspicious reason, no open
// delegation, a mailbox in assist mode with drafts on, and at least one active delegate.
export function showDelegateAction(
  item: Pick<ActivityItem, "category" | "mailboxId" | "suspicious" | "delegation">,
  hint: DelegateHint | null
): boolean {
  if (hint === null || hint.delegates.length === 0) return false;
  if (!(NEEDS_ACTION_CATEGORIES as readonly string[]).includes(item.category)) return false;
  if (item.suspicious.length > 0) return false;
  if (item.delegation !== null && OPEN_DELEGATION.has(item.delegation.status)) return false;
  return hint.draftMailboxIds.has(item.mailboxId);
}

// The two reads of the hint. A mailbox that is not in assist mode costs no request; a failed settings read means "no drafts".
export async function loadDelegateHint(mailboxes: readonly Pick<MailboxView, "id" | "mode">[]): Promise<DelegateHint> {
  const [{ items }, drafts] = await Promise.all([
    api("/api/delegates", delegateListSchema),
    Promise.all(
      mailboxes
        .filter((mailbox) => mailbox.mode === "assist")
        .map(async (mailbox) => {
          try {
            const settings = await api(settingsPath(mailbox.id), settingsViewSchema);
            return settings.mode === "assist" && settings.toolSwitches.create_draft ? mailbox.id : null;
          } catch {
            return null;
          }
        })
    ),
  ]);
  return {
    delegates: items.filter((delegate) => delegate.active),
    draftMailboxIds: new Set(drafts.filter((id): id is string => id !== null)),
  };
}

export function postDelegateMail(emailId: string, delegateId: string): Promise<DelegateMailAnswer> {
  return api(`/api/emails/${encodeURIComponent(emailId)}/delegate`, delegateMailAnswerSchema, {
    method: "POST",
    body: { delegateId },
  });
}

const refusalTexts: Record<string, TextKey> = {
  exists: "dla_exists",
  delegate_inactive: "dla_inactive",
  drafts_off: "dla_drafts_off",
  not_delegable: "dla_not_delegable",
};

// One text for each 409 code; any other error uses the text of the code (`not_found`, `owner_only`, `org_suspended`).
export function delegateErrorKey(error: unknown): TextKey {
  if (error instanceof ApiError && error.status === 409 && Object.hasOwn(refusalTexts, error.code)) {
    return refusalTexts[error.code] ?? "error_generic";
  }
  return errorText(error);
}

export const isExistsError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409 && error.code === "exists";
