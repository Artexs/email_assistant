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
import { addressText } from "../../lib/replies-view";
import { Badge } from "../ui/badge";
import { AddressList } from "./AddressList";

type View = NonNullable<ApprovalDetail["view"]>;

// What an approval item shows, in the waiting list and in the card: the title by kind with the recipient spelled out, the sender
// with the external-sender warning, the subject, the due date, the state, the time left and the version.
export interface SummaryItem {
  state: ApprovalDetail["state"];
  draftReady: boolean;
  heldBy: ApprovalDetail["heldBy"];
  expiresAt: string | null;
  view: View;
}

// The state, the cause of a hold and the time left, in one line.
export function stateLineText(item: SummaryItem, now: Date): string {
  const parts = [t(stateLabelKey(item.state, item.heldBy))];
  if (item.heldBy !== null) parts.push(t(HELD_TEXTS[item.heldBy]));
  // A draft that left the queue has no time left to show.
  if (item.expiresAt !== null && (item.state === "waiting" || item.state === "held")) {
    const left = durationText(new Date(item.expiresAt).getTime() - now.getTime());
    parts.push(t("appr_expires_in", { time: t(left.key, { n: left.n }) }));
  }
  return parts.join(" · ");
}

// The name that the title and the avatar use: the first recipient's name, else the address.
export function recipientName(view: View): string {
  return view.recipient.name === null || view.recipient.name === "" ? view.recipient.address : view.recipient.name;
}

const TO_MARK = "\u0000";

// The title by kind with the recipient spelled out like the To line does: a lookalike domain shows as punycode. The recipient stands
// in its own `bdi`: a direction override in a name cannot reverse the title.
export function ApprovalTitle({ view }: { view: View }) {
  const to = recipientLabel({ name: view.recipient.name, address: addressText(view.recipient.address).text });
  const titleParts = t(KIND_TITLES[view.kind], { to: TO_MARK }).split(TO_MARK);
  const inactive = view.recipientInactive ? ` ${t("appr_inactive")}` : "";
  return (
    <>
      {titleParts[0]}
      <bdi>{to}</bdi>
      {titleParts[1]}
      {inactive}
    </>
  );
}

export interface ApprovalSummaryProps {
  item: SummaryItem;
  now: Date;
}

// The facts to check before a send, one per line: the sender with its warning, the addresses, the subject, the due date, the
// version, the state with the time left. The title and the sender line of the card are not here.
export function ApprovalSummary({ item, now }: ApprovalSummaryProps) {
  const { view } = item;
  const version = view.version ?? 1;
  // A reply always shows its To line (the view lists To and Cc together only when there is a Cc).
  const toList = view.to ?? (view.kind === "reply" ? [view.recipient.address] : undefined);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {view.synthetic && (
        <div>
          <Badge variant="secondary">{t("appr_test_mail")}</Badge>
        </div>
      )}
      {view.sender !== null && (
        <p className="break-words text-sm text-muted-foreground">
          {`${t("appr_from")}: ${isUnknownSender(view.sender.label) ? t("appr_unknown_sender") : view.sender.label}`}
          {view.sender.external && (
            <Badge variant="destructive" className="ml-2 align-middle">
              <TriangleAlert aria-hidden="true" />
              {t("appr_external")}
            </Badge>
          )}
        </p>
      )}
      {toList !== undefined && (
        <p className="break-words text-sm text-muted-foreground">
          {`${t("appr_to")}: `}
          <AddressList entries={toList} />
        </p>
      )}
      {view.cc !== undefined && view.cc.length > 0 && (
        <p className="break-words text-sm text-muted-foreground">
          {`${t("appr_cc")}: `}
          <AddressList entries={view.cc} />
        </p>
      )}
      {view.replyTo !== undefined && view.replyTo.length > 0 && (
        <p className="break-words text-sm text-muted-foreground">
          {`${t("rp_reply_to")}: `}
          <AddressList entries={view.replyTo} />
        </p>
      )}
      <p className="break-words text-sm text-muted-foreground">{`${t("appr_subject")}: ${view.subject}`}</p>
      {view.followUpNumber !== undefined && (
        <p className="text-sm text-muted-foreground">{t("appr_follow_up_number", { n: view.followUpNumber })}</p>
      )}
      {view.dueDate !== null && <p className="text-sm text-muted-foreground">{`${t("appr_due")}: ${view.dueDate}`}</p>}
      {version >= 2 && <p className="text-sm text-muted-foreground">{t("appr_version", { n: version })}</p>}
      <p className="text-sm text-muted-foreground">{stateLineText(item, now)}</p>
      {!item.draftReady && <p className="text-sm text-muted-foreground">{t("appr_preparing")}</p>}
    </div>
  );
}
