import type { BarCategory, GateView } from "@ea/core/web";
import { ShieldAlert } from "lucide-react";

import { t } from "../../i18n";
import { anywayTextKey } from "../../lib/anyway-text";
import { gateText } from "../../lib/gate-text";
import { blockLines, type TrustBlock } from "../../lib/trust-card";
import { FactBox } from "../patterns/FactBox";
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
          <FactBox icon={ShieldAlert}>
            <p className="font-bold">{t("trust_anyway_intro")}</p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {reasons.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </FactBox>
        )}
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
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
