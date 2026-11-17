import { t } from "../../i18n";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

export interface LoopConfirmDialogProps {
  // Drop closes a loop for good; Untrack stops the page from tracking a forward to a delegate. Both can be reopened.
  action: "drop" | "untrack";
  name: string;
  onKeep(): void;
  onConfirm(): void;
  // After the dialog closed: the page puts the focus back (on the button of the row, or on the status line after an answer).
  onReturnFocus(): void;
}

// "Drop this loop?" The focus starts on the safe answer, "Keep it".
export function LoopConfirmDialog({ action, name, onKeep, onConfirm, onReturnFocus }: LoopConfirmDialogProps) {
  const drop = action === "drop";
  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(drop ? "lp_drop_title" : "lp_untrack_title")}</DialogTitle>
          <DialogDescription>{t(drop ? "lp_drop_text" : "lp_untrack_text", { name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onKeep}>
            {t("lp_keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {t(drop ? "lp_drop_confirm" : "lp_untrack_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
