import type { DelegationItem } from "@ea/core/web";

import { t } from "../../i18n";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

export interface DelegationCancelDialogProps {
  item: Pick<DelegationItem, "delegate">;
  onKeep(): void;
  onConfirm(): void;
  // After the dialog closed: the page puts the focus back (on the Cancel button of the row, or on the status line after an answer).
  onReturnFocus(): void;
}

// "Cancel this delegation? It cannot be undone." The focus starts on the safe answer, "Keep".
export function DelegationCancelDialog({ item, onKeep, onConfirm, onReturnFocus }: DelegationCancelDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("dgn_cancel_title")}</DialogTitle>
          <DialogDescription>{t("dgn_cancel_text", { name: item.delegate.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onKeep}>
            {t("dgn_keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t("dgn_cancel_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
