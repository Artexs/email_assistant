import { formatClock, type ActivityItem } from "@ea/core/web";

import { t } from "../../i18n";
import { categoryTagText, confidenceText, delegationText, senderText, subjectText } from "../../lib/activity-text";
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

export function ActivityRow({ item, timeZone, now, mailboxAddress, onOpen, onPatch, onGone }: ActivityRowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        aria-haspopup="dialog"
        className="flex w-full min-w-0 flex-col gap-0.5 text-left"
        onClick={() => onOpen(item.emailId)}
      >
        <span className="block truncate text-sm text-muted-foreground">
          {formatClock(new Date(item.receivedAt), timeZone, now)} · {senderText(item.from)}
          {mailboxAddress !== null && <> · {mailboxAddress}</>}
        </span>
        <span className="block truncate font-medium">{subjectText(item.subject)}</span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {categoryTagText(item.category)} {confidenceText(item.confidence)} · {item.phrase}
          </span>
          {item.delegation !== null && <Badge variant="secondary">{delegationText(item.delegation)}</Badge>}
          {item.undoPending && <Badge variant="outline">{t("act_undo_pending")}</Badge>}
        </span>
      </button>
      <ActionButtons item={item} onPatch={onPatch} onGone={onGone} />
    </div>
  );
}
