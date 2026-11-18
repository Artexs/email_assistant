import type { BarCategory, GateView } from "@ea/core/web";

import { t } from "../../i18n";
import { anywayTextKey } from "../../lib/anyway-text";
import { gateText } from "../../lib/gate-text";
import { blockLines, type TrustBlock } from "../../lib/trust-card";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

export interface SetAnywayDialogProps {
  category: BarCategory | null; // null = closed
  gate: GateView | null;
  // The reasons the evidence gate refused (the flag `trust_ladder` is on). Empty: the real-label text of the gate shows, as before the trust ladder.
  blocks?: readonly TrustBlock[];
  bar: number;
  minKept: number;
  pending: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function SetAnywayDialog({
  category,
  gate,
  blocks = [],
  bar,
  minKept,
  pending,
  onCancel,
  onConfirm,
}: SetAnywayDialogProps) {
  const reasons = blockLines(blocks);
  const text = gate === null || reasons.length > 0 ? null : gateText(gate, bar, minKept);

  return (
    <Dialog open={category !== null} onOpenChange={(next) => !next && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("anyway_title")}</DialogTitle>
          <DialogDescription>
            {category === null ? "" : t(anywayTextKey(category), { category: t(`cat_${category}`) })}
          </DialogDescription>
        </DialogHeader>
        {text !== null && <p className="text-sm">{t(text.key, text.vars)}</p>}
        {reasons.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <p>{t("trust_anyway_intro")}</p>
            <ul className="list-disc pl-5">
              {reasons.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
        )}
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
