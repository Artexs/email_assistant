import { formatClock, type ActivityItem } from "@ea/core/web";
import type { ReactNode } from "react";

import { getLocale, t } from "../../i18n";
import {
  categoryName,
  confidenceText,
  delegationText,
  feedbackStateText,
  ruleLine,
  senderLineText,
  senderText,
  subjectText,
} from "../../lib/activity-text";
import { useMediaQuery } from "../../lib/use-media";
import { CategoryPill } from "../patterns/CategoryPill";
import { FactBox } from "../patterns/FactBox";
import { Badge } from "../ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { ActionButtons, type ActionButtonsProps } from "./ActionButtons";

export interface ActivityPanelProps {
  item: ActivityItem | null; // null: closed
  timeZone: string;
  now: Date;
  mailboxAddress: string | null;
  onClose(): void;
  onPatch: ActionButtonsProps["onPatch"];
  onGone(): void;
}

// One topic of the panel: a card with an `h3`.
function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border bg-card p-4">
      <h3 className="text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function ActivityPanel({ item, timeZone, now, mailboxAddress, onClose, onPatch, onGone }: ActivityPanelProps) {
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <Sheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side={wide ? "right" : "bottom"}
        className={wide ? "sm:max-w-md" : "max-h-[85vh] overflow-y-auto"}
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle>{t("act_panel_title")}</SheetTitle>
        </SheetHeader>
        {item !== null && (
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-2">
              <p className="text-lg font-bold break-words">{subjectText(item.subject)}</p>
              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                <p className="break-words">{senderText(item.from)}</p>
                {item.sender && <p className="break-words">{senderLineText(item.sender)}</p>}
                <p>{t("act_received", { time: formatClock(new Date(item.receivedAt), timeZone, now, getLocale()) })}</p>
                {mailboxAddress !== null && <p className="break-words">{mailboxAddress}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CategoryPill category={item.category} label={categoryName(item.category)} />
                <Badge variant="secondary">{confidenceText(item.confidence)}</Badge>
              </div>
            </div>
            <PanelBlock title={t("act_section_why")}>
              <FactBox>
                <p className="text-sm break-words whitespace-pre-line">{item.aiText ?? t("act_no_reason")}</p>
                {item.rule !== null && <p className="mt-1 text-sm font-bold">{ruleLine(item.rule)}</p>}
              </FactBox>
            </PanelBlock>
            <PanelBlock title={t("act_section_did")}>
              {item.actions.length === 0 ? (
                <p className="text-sm">{item.phrase}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {item.actions.map((action, index) => (
                    <li key={`${action.type}-${index}`}>
                      {action.appliedAt !== null
                        ? t("act_action_at", {
                            phrase: action.phrase,
                            time: formatClock(new Date(action.appliedAt), timeZone, now, getLocale()),
                          })
                        : action.phrase}
                    </li>
                  ))}
                </ul>
              )}
              {item.undoPending && (
                <div>
                  <Badge variant="outline">{t("act_undo_pending")}</Badge>
                </div>
              )}
            </PanelBlock>
            {item.delegation !== null && (
              <PanelBlock title={t("act_section_delegation")}>
                <p className="text-sm break-words">{delegationText(item.delegation)}</p>
                {item.delegation.dueAt !== null && (
                  <p className="text-sm text-muted-foreground">
                    {t("act_dlg_due", {
                      time: formatClock(new Date(item.delegation.dueAt), timeZone, now, getLocale()),
                    })}
                  </p>
                )}
              </PanelBlock>
            )}
            <PanelBlock title={t("act_section_feedback")}>
              <p className="text-sm">{feedbackStateText(item.feedback)}</p>
            </PanelBlock>
            <ActionButtons item={item} onPatch={onPatch} onGone={onGone} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
