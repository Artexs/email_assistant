import { formatClock, type ActivityItem } from "@ea/core/web";

import { t } from "../../i18n/en";
import {
  categoryTagText,
  confidenceText,
  delegationText,
  feedbackStateText,
  senderText,
  subjectText,
} from "../../lib/activity-text";
import { useMediaQuery } from "../../lib/use-media";
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
            <h3 className="font-medium break-words">{subjectText(item.subject)}</h3>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p className="break-words">{senderText(item.from)}</p>
              <p>{t("act_received", { time: formatClock(new Date(item.receivedAt), timeZone, now) })}</p>
              {mailboxAddress !== null && <p className="break-words">{mailboxAddress}</p>}
              <p>
                {categoryTagText(item.category)} {confidenceText(item.confidence)}
              </p>
            </div>
            <section className="flex flex-col gap-1">
              <h4 className="text-sm font-medium">{t("act_section_why")}</h4>
              <p className="text-sm break-words whitespace-pre-line">{item.aiText ?? t("act_no_reason")}</p>
            </section>
            <section className="flex flex-col gap-1">
              <h4 className="text-sm font-medium">{t("act_section_did")}</h4>
              {item.actions.length === 0 ? (
                <p className="text-sm">{item.phrase}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {item.actions.map((action, index) => (
                    <li key={`${action.type}-${index}`}>
                      {action.appliedAt !== null
                        ? t("act_action_at", {
                            phrase: action.phrase,
                            time: formatClock(new Date(action.appliedAt), timeZone, now),
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
            </section>
            {item.delegation !== null && (
              <section className="flex flex-col gap-1">
                <h4 className="text-sm font-medium">{t("act_section_delegation")}</h4>
                <p className="text-sm break-words">{delegationText(item.delegation)}</p>
                {item.delegation.dueAt !== null && (
                  <p className="text-sm text-muted-foreground">
                    {t("act_dlg_due", { time: formatClock(new Date(item.delegation.dueAt), timeZone, now) })}
                  </p>
                )}
              </section>
            )}
            <section className="flex flex-col gap-1">
              <h4 className="text-sm font-medium">{t("act_section_feedback")}</h4>
              <p className="text-sm">{feedbackStateText(item.feedback)}</p>
            </section>
            <ActionButtons item={item} onPatch={onPatch} onGone={onGone} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
