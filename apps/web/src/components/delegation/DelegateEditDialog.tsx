import type { Delegate } from "@ea/core/web";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { t, type TextKey } from "../../i18n";
import { patchDelegate } from "../../lib/delegates-api";
import { checkEdit, editStart, FIELD_LIMITS, patchOutcome, type DelegateField } from "../../lib/delegates-form";
import { singleFlight } from "../../lib/single-flight";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { TextField } from "./TextField";

export interface DelegateEditDialogProps {
  delegate: Delegate;
  // The dialog closes with no change (cancel, Escape).
  onClose(): void;
  // After the dialog closed: the page puts the focus back on the Edit button of the row (or elsewhere, when the row is gone).
  onReturnFocus(): void;
  // The server saved the change.
  onSaved(delegate: Delegate): void;
  // The delegate does not exist any more.
  onGone(): void;
}

interface Problem {
  field: DelegateField;
  key: TextKey;
}

// The owner changes the name and the tags of a delegate. The address shows read only: it never changes (a new address is a new delegate).
// Save is off while nothing differs. After a field error the cursor goes to the field.
export function DelegateEditDialog({ delegate, onClose, onReturnFocus, onSaved, onGone }: DelegateEditDialogProps) {
  const [values, setValues] = useState(() => editStart(delegate));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failure, setFailure] = useState<TextKey | null>(null);
  const [flight] = useState(singleFlight);
  const refs: Record<"name" | "tags", RefObject<HTMLInputElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    tags: useRef<HTMLInputElement>(null),
  };
  const check = checkEdit(delegate, values);

  const show = (next: Problem) => {
    setProblem(next);
    if (next.field !== "email") refs[next.field].current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void flight(async () => {
      setFailure(null);
      const now = checkEdit(delegate, values);
      if (!now.ok) {
        if (!now.unchanged) show({ field: now.field, key: now.key });
        return;
      }
      setProblem(null);
      try {
        onSaved(await patchDelegate(delegate.id, now.patch));
      } catch (error) {
        const outcome = patchOutcome(error);
        if (outcome.kind === "gone") onGone();
        else if (outcome.kind === "field") show({ field: outcome.field, key: outcome.key });
        else setFailure(outcome.key);
      }
    });
  };

  const errorOf = (field: DelegateField): string | null =>
    problem?.field === field ? t(problem.key, FIELD_LIMITS) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          refs.name.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("dlg_edit_title")}</DialogTitle>
            <DialogDescription>{t("dlg_edit_hint")}</DialogDescription>
          </DialogHeader>
          <TextField
            id="delegate-edit-name"
            label={t("dlg_name")}
            value={values.name}
            error={errorOf("name")}
            inputRef={refs.name}
            onChange={(name) => {
              setValues({ ...values, name });
              if (problem?.field === "name") setProblem(null);
            }}
          />
          <TextField
            id="delegate-edit-email"
            label={t("dlg_email")}
            help={t("dlg_edit_address_note")}
            value={delegate.email}
            readOnly
          />
          <TextField
            id="delegate-edit-tags"
            label={t("dlg_tags")}
            help={t("dlg_tags_help")}
            value={values.tags}
            error={errorOf("tags")}
            inputRef={refs.tags}
            onChange={(tags) => {
              setValues({ ...values, tags });
              if (problem?.field === "tags") setProblem(null);
            }}
          />
          {failure !== null && (
            <Alert variant="destructive">
              <AlertDescription>{t(failure)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={check.ok === false && check.unchanged}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
