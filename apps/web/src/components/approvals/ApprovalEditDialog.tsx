import type { ApprovalDetail, ApprovalEditAnswer } from "@ea/core/web";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { t, type TextKey } from "../../i18n";
import { postEdit } from "../../lib/approvals-api";
import {
  editOutcome,
  editRequest,
  editStart,
  isDirty,
  saveState,
  type EditOutcome,
  type EditValues,
} from "../../lib/approvals-edit";
import { copyChecked } from "../../lib/replies-view";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { ApprovalEditForm } from "./ApprovalEditForm";

export interface ApprovalEditDialogProps {
  // A waiting send whose text is still there (`canEdit` and `editStart` hold).
  detail: ApprovalDetail;
  // The dialog closes with no change (cancel, discard).
  onClose(): void;
  // After a close with no change: the focus goes back to the Edit button (the modal dialog has no trigger of its own to return to).
  onReturnFocus(): void;
  // The edit made a new version: the page opens it.
  onSaved(answer: ApprovalEditAnswer): void;
  // The newest version of the send: the page opens it (the typed text is gone).
  onOpenVersion(currentId: string): void;
  // The send cannot be edited any more (closed, or gone): the page says why and reloads.
  onClosedSend(key: TextKey | null): void;
}

// The edit of a waiting draft: subject, body and, for a delegation, the delegate. The form checks the limits of the
// service; the server check is the real one. The send id is the one that the dialog opened with: a newer version answers 409 `changed`.
export function ApprovalEditDialog({
  detail,
  onClose,
  onReturnFocus,
  onSaved,
  onOpenVersion,
  onClosedSend,
}: ApprovalEditDialogProps) {
  const [start] = useState(() => editStart(detail));
  const [values, setValues] = useState<EditValues>(() => start ?? { subject: "", body: "", delegateId: null });
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<EditOutcome | null>(null);
  // "Discard your changes?" replaces the form while it asks; the typed text stays in `values`.
  const [confirming, setConfirming] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const keepFocus = useRef(false);
  const saved = useRef(false);

  // "Keep editing" returns to the form with the cursor in Subject.
  useEffect(() => {
    if (!confirming && keepFocus.current) {
      keepFocus.current = false;
      subjectRef.current?.focus();
    }
  }, [confirming]);

  if (start === null) return null;
  const state = saveState(start, values);

  const requestClose = () => {
    if (pending) return;
    if (confirming) {
      keepFocus.current = true;
      setConfirming(false);
    } else if (isDirty(start, values)) setConfirming(true);
    else onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!state.canSave || pending) return;
    setPending(true);
    setProblem(null);
    try {
      const answer = await postEdit(detail.id, editRequest(start, values));
      saved.current = true;
      onSaved(answer);
    } catch (error) {
      const outcome = editOutcome(error);
      if (outcome.kind === "closed") {
        saved.current = true;
        onClosedSend(outcome.key);
      } else if (outcome.kind === "gone") {
        saved.current = true;
        onClosedSend(null);
      } else setProblem(outcome);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[minmax(0,1fr)] overflow-hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          subjectRef.current?.focus();
        }}
        // After a save or a closed send the page chooses the focus; after a cancel the Edit button gets it back.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!saved.current) onReturnFocus();
        }}
      >
        {confirming ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("appr_edit_discard_title")}</DialogTitle>
              <DialogDescription>{t("appr_edit_discard_text")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("appr_edit_discard")}
              </Button>
              <Button
                type="button"
                // The form is gone: the focus goes to the safe answer.
                ref={(button) => button?.focus()}
                onClick={() => {
                  keepFocus.current = true;
                  setConfirming(false);
                }}
              >
                {t("appr_edit_keep")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("appr_edit_title")}</DialogTitle>
              <DialogDescription>
                {t(detail.view !== null && copyChecked(detail.view) ? "rp_edit_hint_editable" : "appr_edit_hint")}
                {detail.view?.gaps !== undefined && detail.view.gaps.length > 0 && ` ${t("rp_edit_gaps_hint")}`}
              </DialogDescription>
            </DialogHeader>
            <ApprovalEditForm
              detail={detail}
              values={values}
              state={state}
              pending={pending}
              problem={problem}
              subjectRef={subjectRef}
              onChange={setValues}
              onSubmit={submit}
              onCancel={requestClose}
              onOpenNewest={(currentId) => {
                saved.current = true;
                onOpenVersion(currentId);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
