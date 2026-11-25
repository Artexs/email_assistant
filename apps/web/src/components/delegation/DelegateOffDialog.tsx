import type { Delegate } from "@ea/core/web";

import { t } from "../../i18n";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

export interface DelegateOffDialogProps {
  delegate: Pick<Delegate, "name">;
  onCancel(): void;
  onConfirm(): void;
  // After the dialog closed: the page puts the focus back on the switch of the row.
  onReturnFocus(): void;
}

// The question before a delegate goes off. Open delegations stay; new mail is not delegated to the delegate.
// The focus starts on Cancel, the safe answer.
export function DelegateOffDialog({ delegate, onCancel, onConfirm, onReturnFocus }: DelegateOffDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("dlg_off_title", { name: delegate.name })}</DialogTitle>
          <DialogDescription>{t("dlg_off_text")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t("dlg_off_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
