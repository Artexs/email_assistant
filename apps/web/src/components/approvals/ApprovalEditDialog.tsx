import type { ApprovalDetail, ApprovalEditAnswer } from "@ea/core/web";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { t, type TextKey } from "../../i18n";
import { postEdit } from "../../lib/approvals-api";
import {
  delegateOptions,
  EDIT_BODY_MAX,
  EDIT_SUBJECT_MAX,
  editOutcome,
  editRequest,
  editStart,
  isDirty,
  saveState,
  type EditOutcome,
  type EditValues,
} from "../../lib/approvals-edit";
import { recipientLabel } from "../../lib/approvals-view";
import { copyChecked } from "../../lib/replies-view";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

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

const IDS = {
  subject: "approval-edit-subject",
  body: "approval-edit-body",
  count: "approval-edit-count",
  subjectError: "approval-edit-subject-error",
  bodyError: "approval-edit-body-error",
  delegate: "approval-edit-delegate",
};

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
  const options = delegateOptions(detail);
  const newestId = problem?.kind === "changed" ? problem.currentId : null;
  const quote = detail.quote ?? detail.view?.quote?.text ?? null;

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

  const fieldError = (field: "subject" | "body"): string | null => {
    if (problem?.kind === "field" && problem.field === field) return t(problem.key, { max: problem.max });
    return null;
  };
  const subjectError = fieldError("subject");
  const bodyError = fieldError("body");
  const overBody = state.bodyLength > EDIT_BODY_MAX;
  const overSubject = state.subjectLength > EDIT_SUBJECT_MAX;

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
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
              <Button type="button" variant="outline" onClick={onClose}>
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
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{t("appr_edit_title")}</DialogTitle>
              <DialogDescription>
                {t(detail.view !== null && copyChecked(detail.view) ? "rp_edit_hint_editable" : "appr_edit_hint")}
                {detail.view?.gaps !== undefined && detail.view.gaps.length > 0 && ` ${t("rp_edit_gaps_hint")}`}
              </DialogDescription>
            </DialogHeader>
            {!detail.draftRemovable && <p className="text-sm">{t("appr_edit_no_remove")}</p>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={IDS.subject}>{t("appr_subject")}</Label>
              <Input
                id={IDS.subject}
                ref={subjectRef}
                autoComplete="off"
                value={values.subject}
                disabled={pending}
                aria-invalid={!state.subjectOk || subjectError !== null}
                aria-describedby={subjectError === null ? undefined : IDS.subjectError}
                onChange={(event) => setValues({ ...values, subject: event.target.value })}
              />
              {subjectError !== null && (
                <p id={IDS.subjectError} className="text-sm text-destructive">
                  {subjectError}
                </p>
              )}
              {overSubject && subjectError === null && (
                <p className="text-sm text-destructive">{t("appr_edit_subject_error", { max: EDIT_SUBJECT_MAX })}</p>
              )}
            </div>
            {options.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={IDS.delegate}>{t("appr_edit_delegate")}</Label>
                <Select
                  value={values.delegateId ?? undefined}
                  disabled={pending}
                  onValueChange={(delegateId) => setValues({ ...values, delegateId })}
                >
                  <SelectTrigger id={IDS.delegate} className="max-w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((delegate) => (
                      <SelectItem key={delegate.id} value={delegate.id}>
                        {recipientLabel({ name: delegate.name, address: delegate.email })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={IDS.body}>{t("appr_edit_body")}</Label>
              <Textarea
                id={IDS.body}
                rows={8}
                value={values.body}
                disabled={pending}
                aria-invalid={!state.bodyOk || bodyError !== null}
                aria-describedby={`${IDS.count}${bodyError === null ? "" : ` ${IDS.bodyError}`}`}
                onChange={(event) => setValues({ ...values, body: event.target.value })}
              />
              <p id={IDS.count} className={overBody ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {t("appr_edit_count", { n: state.bodyLength, max: EDIT_BODY_MAX })}
              </p>
              {bodyError !== null && (
                <p id={IDS.bodyError} className="text-sm text-destructive">
                  {bodyError}
                </p>
              )}
            </div>
            {quote !== null && (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">{t("appr_quote")}</p>
                <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm text-muted-foreground">
                  {quote}
                </p>
                <p className="text-sm text-muted-foreground">{t("appr_edit_quote_note")}</p>
              </div>
            )}
            {problem !== null && problem.kind !== "field" && (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
                {problem.kind === "changed" && (
                  <>
                    <p>{t("appr_edit_changed")}</p>
                    {newestId !== null && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          saved.current = true;
                          onOpenVersion(newestId);
                        }}
                      >
                        {t("appr_edit_open_new")}
                      </Button>
                    )}
                  </>
                )}
                {(problem.kind === "message" || problem.kind === "error") && <p>{t(problem.key)}</p>}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={requestClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !state.canSave}>
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
