import { formatClock, type ActivityItem } from "@ea/core/web";

import { t } from "../../i18n/en";
import { categoryTagText, confidenceText, delegationText, senderText, subjectText } from "../../lib/activity-text";
import { Badge } from "../ui/badge";

export interface ActivityRowProps {
  item: ActivityItem;
  timeZone: string;
  now: Date;
  mailboxAddress: string | null; // null: not shown
}

export function ActivityRow({ item, timeZone, now, mailboxAddress }: ActivityRowProps) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="truncate text-sm text-muted-foreground">
        {formatClock(new Date(item.receivedAt), timeZone, now)} · {senderText(item.from)}
        {mailboxAddress !== null && <> · {mailboxAddress}</>}
      </p>
      <p className="truncate font-medium">{subjectText(item.subject)}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          {categoryTagText(item.category)} {confidenceText(item.confidence)} · {item.phrase}
        </span>
        {item.delegation !== null && <Badge variant="secondary">{delegationText(item.delegation)}</Badge>}
        {item.undoPending && <Badge variant="outline">{t("act_undo_pending")}</Badge>}
      </div>
    </div>
  );
}
