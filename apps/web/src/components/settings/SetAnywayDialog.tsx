import type { BarCategory, GateView } from "@ea/core/web";

import { t } from "../../i18n/en";
import { gateText } from "../../lib/gate-text";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

export interface SetAnywayDialogProps {
  category: BarCategory | null; // null = closed
  gate: GateView | null;
  bar: number;
  minKept: number;
  pending: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function SetAnywayDialog({ category, gate, bar, minKept, pending, onCancel, onConfirm }: SetAnywayDialogProps) {
  const text = gate === null ? null : gateText(gate, bar, minKept);

  return (
    <Dialog open={category !== null} onOpenChange={(next) => !next && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("anyway_title")}</DialogTitle>
          <DialogDescription>
            {category === null ? "" : t("anyway_text", { category: t(`cat_${category}`) })}
          </DialogDescription>
        </DialogHeader>
        {text !== null && <p className="text-sm">{t(text.key, text.vars)}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {t("anyway_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
