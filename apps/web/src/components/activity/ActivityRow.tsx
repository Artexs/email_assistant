import { formatClock, type ActivityItem } from "@ea/core/web";
import { cn } from "cn";

import { getLocale, t } from "../../i18n";
import {
  categoryName,
  confidenceText,
  delegationText,
  ruleName,
  senderText,
  subjectText,
} from "../../lib/activity-text";
import { categoryLook } from "../../lib/category-look";
import { CategoryPill } from "../patterns/CategoryPill";
import { Badge } from "../ui/badge";
import { ActionButtons, type ActionButtonsProps } from "./ActionButtons";

export interface ActivityRowProps {
  item: ActivityItem;
  timeZone: string;
  now: Date;
  mailboxAddress: string | null; // null: not shown
  onOpen(emailId: string): void;
  onPatch: ActionButtonsProps["onPatch"];
  onGone(): void;
}

// One mail: the category tile, the subject and time, the sender and what the assistant did, the category pill and the badges.
// The actions sit beside the text; on a phone their column is two icon buttons wide and wraps downwards. A click on the
// text opens the panel; a click on an action does not.
export function ActivityRow({ item, timeZone, now, mailboxAddress, onOpen, onPatch, onGone }: ActivityRowProps) {
  const { icon: Icon, tone } = categoryLook[item.category];
  return (
    <div className="flex min-w-0 items-start gap-3 sm:items-center">
      <button
        type="button"
        aria-haspopup="dialog"
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        onClick={() => onOpen(item.emailId)}
      >
        <span aria-hidden="true" className={cn("flex size-11 shrink-0 items-center justify-center rounded-md", tone)}>
          <Icon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-bold">{subjectText(item.subject)}</span>
            <span className="shrink-0 text-sm text-muted-foreground">
              {formatClock(new Date(item.receivedAt), timeZone, now, getLocale())}
            </span>
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {senderText(item.from)}
            {mailboxAddress !== null && <> · {mailboxAddress}</>} · {item.phrase}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <CategoryPill category={item.category} label={categoryName(item.category)} />
            <Badge variant="secondary">{confidenceText(item.confidence)}</Badge>
            {item.rule !== null && <Badge variant="outline">{ruleName(item.rule)}</Badge>}
            {item.delegation !== null && <Badge variant="secondary">{delegationText(item.delegation)}</Badge>}
            {item.undoPending && <Badge variant="outline">{t("act_undo_pending")}</Badge>}
          </span>
        </span>
      </button>
      <ActionButtons item={item} onPatch={onPatch} onGone={onGone} />
    </div>
  );
}
