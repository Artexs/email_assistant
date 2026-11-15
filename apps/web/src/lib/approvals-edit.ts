import {
  approvalConflictSchema,
  cleanUserText,
  EDIT_BODY_MAX,
  EDIT_SUBJECT_MAX,
  type ApprovalDelegate,
  type ApprovalDetail,
  type ApprovalEditBody,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { closedTextKey } from "./approvals-view";
import { errorText } from "./errors";

export { EDIT_BODY_MAX, EDIT_SUBJECT_MAX };

export interface EditValues {
  subject: string;
  body: string;
  // The delegate that the picker shows; null while the current delegate is not on the list of active ones.
  delegateId: string | null;
}

// An owner who may write edits a waiting delegation, clarification or follow-up (Q2: a reminder has no edit; a held send is approved already).
export function canEdit(detail: Pick<ApprovalDetail, "state" | "kind">, who: { owner: boolean; canWrite: boolean }) {
  return (
    who.owner &&
    who.canWrite &&
    detail.state === "waiting" &&
    (detail.kind === "delegation" || detail.kind === "clarification" || detail.kind === "follow_up")
  );
}

// The delegate of the draft is the active delegate whose address the view shows as the recipient.
function currentDelegate(detail: ApprovalDetail): ApprovalDelegate | undefined {
  const address = detail.view?.recipient.address.toLowerCase();
  return detail.delegates.find((delegate) => delegate.email.toLowerCase() === address);
}

// The values that the form starts with: the subject and the full body of the draft as the detail shows them.
// `null` when retention cleared the text (nothing to edit).
export function editStart(detail: ApprovalDetail): EditValues | null {
  if (detail.view === null) return null;
  return {
    subject: detail.view.subject,
    body: detail.view.body,
    delegateId: detail.kind === "delegation" ? (currentDelegate(detail)?.id ?? null) : null,
  };
}

// The picker lists the current delegate first, then the others in the order of the answer.
export function delegateOptions(detail: ApprovalDetail): ApprovalDelegate[] {
  if (detail.kind !== "delegation") return [];
  const current = currentDelegate(detail);
  return current === undefined ? detail.delegates : [current, ...detail.delegates.filter((d) => d.id !== current.id)];
}

export interface SaveState {
  subjectLength: number;
  bodyLength: number;
  subjectOk: boolean;
  bodyOk: boolean;
  // Any difference from the start values, after the same cleaning that the server applies.
  changed: boolean;
  canSave: boolean;
}

// The limits are those of the service (D3): the length after `cleanUserText`. The server check is the real one.
export function saveState(start: EditValues, values: EditValues): SaveState {
  const subject = cleanUserText(values.subject, { oneLine: true });
  const body = cleanUserText(values.body, { oneLine: false });
  const subjectOk = subject.length >= 1 && subject.length <= EDIT_SUBJECT_MAX;
  const bodyOk = body.length >= 1 && body.length <= EDIT_BODY_MAX;
  const changed =
    subject !== cleanUserText(start.subject, { oneLine: true }) ||
    body !== cleanUserText(start.body, { oneLine: false }) ||
    values.delegateId !== start.delegateId;
  return {
    subjectLength: subject.length,
    bodyLength: body.length,
    subjectOk,
    bodyOk,
    changed,
    canSave: subjectOk && bodyOk && changed,
  };
}

// Typed changes of any kind (also a space): closing the dialog asks first, so a stray click loses nothing.
export function isDirty(start: EditValues, values: EditValues): boolean {
  return values.subject !== start.subject || values.body !== start.body || values.delegateId !== start.delegateId;
}

// The request body: the cleaned text, and a delegate only when the owner picked another one.
export function editRequest(start: EditValues, values: EditValues): ApprovalEditBody {
  const subject = cleanUserText(values.subject, { oneLine: true });
  const body = cleanUserText(values.body, { oneLine: false });
  return values.delegateId !== null && values.delegateId !== start.delegateId
    ? { subject, body, delegateId: values.delegateId }
    : { subject, body };
}

// What the page does with a failed edit.
export type EditOutcome =
  | { kind: "changed"; currentId: string | null } // keep the typed text; offer the new version
  | { kind: "closed"; key: TextKey } // close the dialog, say why, reload
  | { kind: "field"; field: "subject" | "body"; key: TextKey; max: number } // the text of one field
  | { kind: "message"; key: TextKey } // stay in the dialog and say it
  | { kind: "gone" } // the send does not exist (any more)
  | { kind: "error"; key: TextKey };

export function editOutcome(error: unknown): EditOutcome {
  if (!(error instanceof ApiError)) return { kind: "error", key: errorText(error) };
  if (error.status === 404) return { kind: "gone" };
  if (error.status === 409) {
    const conflict = approvalConflictSchema.safeParse(error.raw);
    if (!conflict.success) return { kind: "error", key: errorText(error) };
    switch (conflict.data.error) {
      case "changed":
        return { kind: "changed", currentId: conflict.data.currentId ?? null };
      case "closed":
        return { kind: "closed", key: closedTextKey(conflict.data.state) };
      case "drafts_off":
        return { kind: "message", key: "appr_edit_drafts_off" };
      case "draft_not_ready":
        return { kind: "error", key: errorText(error) };
    }
  }
  if (error.status === 400) {
    switch (error.code) {
      case "unchanged":
        return { kind: "message", key: "appr_edit_unchanged" };
      case "delegate_inactive":
        return { kind: "message", key: "appr_edit_delegate_inactive" };
      case "not_editable":
        return { kind: "message", key: "appr_edit_not_editable" };
      case "validation": {
        const path = error.details?.[0]?.path;
        if (path === "subject")
          return { kind: "field", field: "subject", key: "appr_edit_subject_error", max: EDIT_SUBJECT_MAX };
        if (path === "body") return { kind: "field", field: "body", key: "appr_edit_body_error", max: EDIT_BODY_MAX };
      }
    }
  }
  return { kind: "error", key: errorText(error) };
}
