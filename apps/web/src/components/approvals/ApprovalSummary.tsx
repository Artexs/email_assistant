import type { ApprovalDetail } from "@ea/core/web";
import { TriangleAlert } from "lucide-react";

import { t } from "../../i18n";
import {
  durationText,
  HELD_TEXTS,
  isUnknownSender,
  KIND_TITLES,
  recipientLabel,
  stateLabelKey,
} from "../../lib/approvals-view";
import { Badge } from "../ui/badge";

type View = NonNullable<ApprovalDetail["view"]>;

// What an approval item shows, in the list and in the detail: the title by kind with the recipient spelled out, the sender
// with the external-sender warning, the subject, the due date, the state, the time left and the version.
export interface SummaryItem {
  state: ApprovalDetail["state"];
  draftReady: boolean;
  heldBy: ApprovalDetail["heldBy"];
  expiresAt: string | null;
  view: View;
}

export interface ApprovalSummaryProps {
  item: SummaryItem;
  now: Date;
  // The detail prints the title as a heading.
  titleAs?: "p" | "h2";
}

export function ApprovalSummary({ item, now, titleAs: Title = "p" }: ApprovalSummaryProps) {
  const { view } = item;
  const to = recipientLabel(view.recipient);
  const inactive = view.recipientInactive ? ` ${t("appr_inactive")}` : "";
  const version = view.version ?? 1;
  const stateParts = [t(stateLabelKey(item.state, item.heldBy))];
  if (item.heldBy !== null) stateParts.push(t(HELD_TEXTS[item.heldBy]));
  if (item.expiresAt !== null) {
    const left = durationText(new Date(item.expiresAt).getTime() - now.getTime());
    stateParts.push(t("appr_expires_in", { time: t(left.key, { n: left.n }) }));
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Title className="break-words font-medium">{`${t(KIND_TITLES[view.kind], { to })}${inactive}`}</Title>
      {view.synthetic && (
        <div>
          <Badge variant="outline">{t("appr_test_mail")}</Badge>
        </div>
      )}
      {view.sender !== null && (
        <p className="break-words text-sm">
          {`${t("appr_from")}: ${isUnknownSender(view.sender.label) ? t("appr_unknown_sender") : view.sender.label}`}
          {view.sender.external && (
            <Badge variant="outline" className="ml-2 align-middle">
              <TriangleAlert aria-hidden="true" />
              {t("appr_external")}
            </Badge>
          )}
        </p>
      )}
      <p className="break-words text-sm">{`${t("appr_subject")}: ${view.subject}`}</p>
      {view.dueDate !== null && <p className="text-sm">{`${t("appr_due")}: ${view.dueDate}`}</p>}
      {version >= 2 && <p className="text-sm">{t("appr_version", { n: version })}</p>}
      <p className="text-sm text-muted-foreground">{stateParts.join(" · ")}</p>
      {!item.draftReady && <p className="text-sm text-muted-foreground">{t("appr_preparing")}</p>}
    </div>
  );
}
