import type { ApprovalDetail, SenderLine } from "@ea/core/web";
import { TriangleAlert } from "lucide-react";

import { t } from "../../i18n";
import { senderLineText } from "../../lib/activity-text";
import {
  durationText,
  HELD_TEXTS,
  isUnknownSender,
  KIND_TITLES,
  recipientLabel,
  stateLabelKey,
} from "../../lib/approvals-view";
import { addressText } from "../../lib/replies-view";
import { Badge } from "../ui/badge";
import { AddressList } from "./AddressList";

type View = NonNullable<ApprovalDetail["view"]>;

// What an approval item shows, in the list and in the detail: the title by kind with the recipient spelled out, the sender
// with the external-sender warning, the subject, the due date, the state, the time left and the version.
export interface SummaryItem {
  state: ApprovalDetail["state"];
  draftReady: boolean;
  heldBy: ApprovalDetail["heldBy"];
  expiresAt: string | null;
  view: View;
  // The line about the sender of the original mail. Absent or null: no line.
  sender?: SenderLine | null;
}

export interface ApprovalSummaryProps {
  item: SummaryItem;
  now: Date;
  // The detail prints the title as a heading.
  titleAs?: "p" | "h2";
  // `inline`: the version, the state and the time left close the summary. `none`: the page shows them (`SummaryFooter`) where it wants.
  footer?: "inline" | "none";
}

// The version, the state with the time left and the note that the draft is not ready.
export function SummaryFooter({ item, now }: { item: SummaryItem; now: Date }) {
  const version = item.view.version ?? 1;
  const stateParts = [t(stateLabelKey(item.state, item.heldBy))];
  if (item.heldBy !== null) stateParts.push(t(HELD_TEXTS[item.heldBy]));
  if (item.expiresAt !== null) {
    const left = durationText(new Date(item.expiresAt).getTime() - now.getTime());
    stateParts.push(t("appr_expires_in", { time: t(left.key, { n: left.n }) }));
  }
  return (
    <>
      {version >= 2 && <p className="text-sm">{t("appr_version", { n: version })}</p>}
      <p className="text-sm text-muted-foreground">{stateParts.join(" · ")}</p>
      {!item.draftReady && <p className="text-sm text-muted-foreground">{t("appr_preparing")}</p>}
    </>
  );
}

const TO_MARK = "\u0000";

export function ApprovalSummary({ item, now, titleAs: Title = "p", footer = "inline" }: ApprovalSummaryProps) {
  const { view } = item;
  // The title spells the first recipient out like the To line does: a lookalike domain shows as punycode.
  const to = recipientLabel({ name: view.recipient.name, address: addressText(view.recipient.address).text });
  // The recipient stands in its own `bdi`: a direction override in a name cannot reverse the title.
  const titleParts = t(KIND_TITLES[view.kind], { to: TO_MARK }).split(TO_MARK);
  const inactive = view.recipientInactive ? ` ${t("appr_inactive")}` : "";
  // A reply always shows its To line (the view lists To and Cc together only when there is a Cc).
  const toList = view.to ?? (view.kind === "reply" ? [view.recipient.address] : undefined);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Title className="break-words font-medium">
        {titleParts[0]}
        <bdi>{to}</bdi>
        {titleParts[1]}
        {inactive}
      </Title>
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
      {item.sender && <p className="break-words text-sm">{senderLineText(item.sender)}</p>}
      {toList !== undefined && (
        <p className="break-words text-sm">
          {`${t("appr_to")}: `}
          <AddressList entries={toList} />
        </p>
      )}
      {view.cc !== undefined && view.cc.length > 0 && (
        <p className="break-words text-sm">
          {`${t("appr_cc")}: `}
          <AddressList entries={view.cc} />
        </p>
      )}
      {view.replyTo !== undefined && view.replyTo.length > 0 && (
        <p className="break-words text-sm">
          {`${t("rp_reply_to")}: `}
          <AddressList entries={view.replyTo} />
        </p>
      )}
      <p className="break-words text-sm">{`${t("appr_subject")}: ${view.subject}`}</p>
      {view.followUpNumber !== undefined && (
        <p className="text-sm">{t("appr_follow_up_number", { n: view.followUpNumber })}</p>
      )}
      {view.dueDate !== null && <p className="text-sm">{`${t("appr_due")}: ${view.dueDate}`}</p>}
      {footer === "inline" && <SummaryFooter item={item} now={now} />}
    </div>
  );
}
