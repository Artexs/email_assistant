import type { RejectReasonBody } from "@ea/core/web";
import { Pencil, Send, X } from "lucide-react";
import { useEffect, useId, useRef, type Ref } from "react";

import { t, type TextKey } from "../../i18n";
import { REASON_TEXTS, REJECT_REASONS, type Decisions } from "../../lib/approvals-view";
import { StickyActions } from "../patterns/StickyActions";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const SKIP = "skip";

export interface ApprovalActionsProps {
  decisions: Decisions;
  // The draft is not ready (its mailbox copy is still made): the server would answer 409, so the button is off.
  draftReady: boolean;
  // Every decision button is off: a request runs, the card was shown a moment ago, or the draft expired.
  busy: boolean;
  // A member reads only: the page says why there is no button.
  ownerOnly: boolean;
  // An owner may edit a waiting delegation, clarification, follow-up or reply (`canEdit`).
  canEdit: boolean;
  // The draft is past its expiry time: it says so, and Yes and No stay off.
  expired?: boolean;
  // The text that tells why Approve is off (a reply with a gap), or null.
  approveBlock?: TextKey | null;
  // The Change button, so the page can give the focus back to it when the dialog closes with no change.
  editRef?: Ref<HTMLButtonElement>;
  onApprove(): void;
  onReject(): void;
  onEdit(): void;
}

// The decision bar: "Yes, send it", "Change" and "No" in the fixed bar of a phone.
export function ApprovalActions({
  decisions,
  draftReady,
  busy,
  ownerOnly,
  canEdit,
  expired = false,
  approveBlock = null,
  editRef,
  onApprove,
  onReject,
  onEdit,
}: ApprovalActionsProps) {
  const blockId = useId();
  if (ownerOnly) {
    return (
      <StickyActions>
        <p className="text-sm text-muted-foreground">{t("owner_only")}</p>
      </StickyActions>
    );
  }
  if (!decisions.approve && !decisions.reject) return null;
  return (
    <StickyActions>
      {decisions.approve && (
        <Button
          type="button"
          size="lg"
          disabled={busy || expired || !draftReady || approveBlock !== null}
          aria-describedby={approveBlock === null ? undefined : blockId}
          onClick={onApprove}
        >
          <Send aria-hidden="true" />
          {t("appr_approve")}
        </Button>
      )}
      {canEdit && (
        <Button ref={editRef} type="button" variant="soft" disabled={busy} onClick={onEdit}>
          <Pencil aria-hidden="true" />
          {t("appr_edit")}
        </Button>
      )}
      {decisions.reject && (
        <Button type="button" variant="ghost" disabled={busy || expired} onClick={onReject}>
          <X aria-hidden="true" />
          {t("appr_reject")}
        </Button>
      )}
      {approveBlock !== null && decisions.approve && (
        <p id={blockId} className="w-full text-sm text-muted-foreground">
          {t(approveBlock)}
        </p>
      )}
      {expired && <p className="w-full text-sm text-muted-foreground">{t("appr_expired_now")}</p>}
    </StickyActions>
  );
}

// The select that was open is gone: the focus goes to the saved line once, when it appears.
function SavedLine() {
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => line.current?.focus(), []);
  return (
    <p
      role="status"
      tabIndex={-1}
      ref={line}
      className="w-full rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      {t("appr_reason_saved")}
    </p>
  );
}

export interface ApprovalOutcomeProps {
  // The result line: "Sent to …". It takes the focus, so a screen reader reads it and the focus does not fall to the page start.
  text: string;
  statusRef: Ref<HTMLParagraphElement>;
  // "Next draft": the card stays until the user moves on (a failed or unclear approve).
  onNext?: () => void;
  // The reason question after a "No": null once it ends.
  reason?: { saved: boolean; busy: boolean; onPick(reason: RejectReasonBody["reason"] | null): void } | null;
}

// What the decision bar shows after an answer, in place of the three buttons.
export function ApprovalOutcome({ text, statusRef, onNext, reason = null }: ApprovalOutcomeProps) {
  return (
    <StickyActions>
      <p
        role="status"
        tabIndex={-1}
        ref={statusRef}
        className="w-full rounded-md text-base font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        {text}
      </p>
      {onNext !== undefined && (
        <Button type="button" size="lg" onClick={onNext}>
          {t("appr_next")}
        </Button>
      )}
      {reason !== null &&
        (reason.saved ? <SavedLine /> : <RejectReason disabled={reason.busy} onPick={reason.onPick} />)}
    </StickyActions>
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
