import type { ApprovalItem } from "@ea/core/web";
import { useState } from "react";

import { t } from "../../i18n";
import { StepDots } from "../patterns/StepDots";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { WaitingList } from "./WaitingList";

export interface QueueHeadProps {
  step: { current: number; total: number } | null;
  // "Later" is off while a request runs or an outcome shows.
  laterOff: boolean;
  items: readonly ApprovalItem[];
  focusId: string | null;
  now: Date;
  waiting: number;
  onLater(): void;
  onPick(id: string): void;
}

// The row above the card: the step dots with "2 of 5", "Later" (away from the thumb), and below `lg` the button that opens the list of
// every waiting draft. From `lg` the list sits beside the card.
export function QueueHead({ step, laterOff, items, focusId, now, waiting, onLater, onPick }: QueueHeadProps) {
  const [sheet, setSheet] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {step !== null && (
        <>
          <StepDots
            current={step.current}
            total={step.total}
            label={t("appr_progress_label", { current: step.current, total: step.total })}
          />
          <span className="text-sm font-bold">{t("appr_progress", { current: step.current, total: step.total })}</span>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        {step !== null && (
          <Button type="button" variant="ghost" size="sm" disabled={laterOff} onClick={onLater}>
            {t("appr_later")}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="lg:hidden" onClick={() => setSheet(true)}>
          {t("appr_all_waiting", { n: waiting })}
        </Button>
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="max-h-[80dvh] lg:hidden">
          <SheetHeader>
            <SheetTitle>{t("appr_sheet_title")}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <WaitingList
              items={items}
              focusId={focusId}
              now={now}
              onPick={(id) => {
                setSheet(false);
                onPick(id);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
