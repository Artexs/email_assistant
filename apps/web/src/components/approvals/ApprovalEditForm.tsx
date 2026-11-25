import type { ApprovalDetail } from "@ea/core/web";
import type { FormEvent, RefObject } from "react";
import { CircleAlert } from "lucide-react";

import { t } from "../../i18n";
import {
  delegateOptions,
  EDIT_BODY_MAX,
  EDIT_SUBJECT_MAX,
  type EditOutcome,
  type EditValues,
  type SaveState,
} from "../../lib/approvals-edit";
import { recipientLabel } from "../../lib/approvals-view";
import { FactBox } from "../patterns/FactBox";
import { Button } from "../ui/button";
import { DialogFooter } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

export const EDIT_IDS = {
  subject: "approval-edit-subject",
  body: "approval-edit-body",
  count: "approval-edit-count",
  subjectError: "approval-edit-subject-error",
  bodyError: "approval-edit-body-error",
  delegate: "approval-edit-delegate",
};

export interface ApprovalEditFormProps {
  detail: ApprovalDetail;
  values: EditValues;
  state: SaveState;
  pending: boolean;
  problem: EditOutcome | null;
  subjectRef?: RefObject<HTMLInputElement | null>;
  onChange(values: EditValues): void;
  onSubmit(event: FormEvent): void;
  onCancel(): void;
  onOpenNewest(currentId: string): void;
}

// The fields and the buttons of the edit dialog (its header sits above, in the dialog). The fields scroll inside the dialog; Save and Cancel stay at its bottom edge.
export function ApprovalEditForm({
  detail,
  values,
  state,
  pending,
  problem,
  subjectRef,
  onChange,
  onSubmit,
  onCancel,
  onOpenNewest,
}: ApprovalEditFormProps) {
  const options = delegateOptions(detail);
  const newestId = problem?.kind === "changed" ? problem.currentId : null;
  const quote = detail.quote ?? detail.view?.quote?.text ?? null;
  const fieldError = (field: "subject" | "body"): string | null => {
    if (problem?.kind === "field" && problem.field === field) return t(problem.key, { max: problem.max });
    return null;
  };
  const subjectError = fieldError("subject");
  const bodyError = fieldError("body");
  const overBody = state.bodyLength > EDIT_BODY_MAX;
  const overSubject = state.subjectLength > EDIT_SUBJECT_MAX;

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-col gap-4" noValidate>
      <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1 py-1">
        {!detail.draftRemovable && <FactBox>{t("appr_edit_no_remove")}</FactBox>}
        <div className="flex flex-col gap-2">
          <Label htmlFor={EDIT_IDS.subject}>{t("appr_subject")}</Label>
          <Input
            id={EDIT_IDS.subject}
            ref={subjectRef}
            autoComplete="off"
            value={values.subject}
            disabled={pending}
            aria-invalid={!state.subjectOk || subjectError !== null}
            aria-describedby={subjectError === null ? undefined : EDIT_IDS.subjectError}
            onChange={(event) => onChange({ ...values, subject: event.target.value })}
          />
          {subjectError !== null && (
            <p id={EDIT_IDS.subjectError} className="text-sm text-destructive">
              {subjectError}
            </p>
          )}
          {overSubject && subjectError === null && (
            <p className="text-sm text-destructive">{t("appr_edit_subject_error", { max: EDIT_SUBJECT_MAX })}</p>
          )}
        </div>
        {options.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={EDIT_IDS.delegate}>{t("appr_edit_delegate")}</Label>
            <Select
              value={values.delegateId ?? undefined}
              disabled={pending}
              onValueChange={(delegateId) => onChange({ ...values, delegateId })}
            >
              <SelectTrigger id={EDIT_IDS.delegate} className="max-w-full">
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
        <div className="flex flex-col gap-2">
          <Label htmlFor={EDIT_IDS.body}>{t("appr_edit_body")}</Label>
          <Textarea
            id={EDIT_IDS.body}
            rows={8}
            className="min-h-48 text-base lg:min-h-72"
            value={values.body}
            disabled={pending}
            aria-invalid={!state.bodyOk || bodyError !== null}
            aria-describedby={`${EDIT_IDS.count}${bodyError === null ? "" : ` ${EDIT_IDS.bodyError}`}`}
            onChange={(event) => onChange({ ...values, body: event.target.value })}
          />
          <p id={EDIT_IDS.count} className={overBody ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {t("appr_edit_count", { n: state.bodyLength, max: EDIT_BODY_MAX })}
          </p>
          {bodyError !== null && (
            <p id={EDIT_IDS.bodyError} className="text-sm text-destructive">
              {bodyError}
            </p>
          )}
        </div>
        {quote !== null && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold">{t("appr_quote")}</p>
            <p className="rounded-md bg-muted p-3 text-sm break-words whitespace-pre-wrap text-muted-foreground">
              {quote}
            </p>
            <FactBox>{t("appr_edit_quote_note")}</FactBox>
          </div>
        )}
        {problem !== null && problem.kind !== "field" && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
            {problem.kind === "changed" && (
              <>
                <p>{t("appr_edit_changed")}</p>
                {newestId !== null && (
                  <Button type="button" variant="outline" onClick={() => onOpenNewest(newestId)}>
                    {t("appr_edit_open_new")}
                  </Button>
                )}
              </>
            )}
            {(problem.kind === "message" || problem.kind === "error") && (
              <p className="flex items-start gap-2">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t(problem.key)}
              </p>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || !state.canSave}>
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
