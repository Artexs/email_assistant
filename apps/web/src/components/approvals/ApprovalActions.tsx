import type { RejectReasonBody } from "@ea/core/web";
import { useId, type Ref } from "react";

import { t, type TextKey } from "../../i18n";
import { REASON_TEXTS, REJECT_REASONS, type Decisions } from "../../lib/approvals-view";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const SKIP = "skip";

export interface ApprovalActionsProps {
  decisions: Decisions;
  // The draft is not ready (its mailbox copy is still made): the server would answer 409, so the button is off.
  draftReady: boolean;
  busy: boolean;
  // A member reads only: the page says why there is no button.
  ownerOnly: boolean;
  // An owner may edit a waiting delegation, clarification, follow-up or reply (`canEdit`).
  canEdit: boolean;
  // The text that tells why Approve is off (a reply with a gap), or null.
  approveBlock?: TextKey | null;
  // The Edit button, so the page can give the focus back to it when the dialog closes with no change.
  editRef?: Ref<HTMLButtonElement>;
  onApprove(): void;
  onReject(): void;
  onEdit(): void;
}

export function ApprovalActions({
  decisions,
  draftReady,
  busy,
  ownerOnly,
  canEdit,
  approveBlock = null,
  editRef,
  onApprove,
  onReject,
  onEdit,
}: ApprovalActionsProps) {
  const blockId = useId();
  if (ownerOnly) return <p className="text-sm text-muted-foreground">{t("owner_only")}</p>;
  if (!decisions.approve && !decisions.reject) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {decisions.approve && (
        <Button
          type="button"
          disabled={busy || !draftReady || approveBlock !== null}
          aria-describedby={approveBlock === null ? undefined : blockId}
          onClick={onApprove}
        >
          {t("appr_approve")}
        </Button>
      )}
      {decisions.reject && (
        <Button type="button" variant="outline" disabled={busy} onClick={onReject}>
          {t("appr_reject")}
        </Button>
      )}
      {canEdit && (
        <Button ref={editRef} type="button" variant="outline" disabled={busy} onClick={onEdit}>
          {t("appr_edit")}
        </Button>
      )}
      {approveBlock !== null && decisions.approve && (
        <p id={blockId} className="w-full text-sm text-muted-foreground">
          {t(approveBlock)}
        </p>
      )}
    </div>
  );
}

// The value of the select: a reason, `null` for "Skip" (the page saves nothing), `undefined` for an unknown value.
export function reasonChoice(value: string): RejectReasonBody["reason"] | null | undefined {
  if (value === SKIP) return null;
  return REJECT_REASONS.find((candidate) => candidate === value);
}

export interface RejectReasonProps {
  // The select is off while the reason is saved. The page hides it after a choice or "Skip" (`null`).
  disabled: boolean;
  onPick(reason: RejectReasonBody["reason"] | null): void;
}

// After a reject while `mistake_capture` is on: an optional reason. "Skip" closes it without a request.
export function RejectReason({ disabled, onPick }: RejectReasonProps) {
  const onChange = (value: string) => {
    const choice = reasonChoice(value);
    if (choice !== undefined) onPick(choice);
  };
  return (
    <div className="flex max-w-xs flex-col gap-1.5">
      <Label htmlFor="approval-reason">{t("appr_reason_label")}</Label>
      <Select disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id="approval-reason">
          <SelectValue placeholder={t("appr_reason_placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {REJECT_REASONS.map((reason) => (
            <SelectItem key={reason} value={reason}>
              {t(REASON_TEXTS[reason])}
            </SelectItem>
          ))}
          <SelectItem value={SKIP}>{t("appr_reason_skip")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
