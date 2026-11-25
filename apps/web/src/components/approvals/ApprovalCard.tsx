import type { ApprovalDetail } from "@ea/core/web";
import type { ReactNode, Ref } from "react";

import { t } from "../../i18n";
import { senderLineText } from "../../lib/activity-text";
import { stateLabelKey } from "../../lib/approvals-view";
import { copyChecked, endReasonKey } from "../../lib/replies-view";
import { FactBox } from "../patterns/FactBox";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { Card, CardContent } from "../ui/card";
import { ApprovalSummary, ApprovalTitle, recipientName } from "./ApprovalSummary";

export interface ApprovalCardProps {
  detail: ApprovalDetail;
  now: Date;
  // The title takes the focus when a new card opens.
  titleRef?: Ref<HTMLHeadingElement>;
  // The decision bar and the messages of the page.
  children: ReactNode;
}

const MODE_TEXTS = {
  from: "rp_mode_from",
  all: "rp_mode_all",
  reply_to: "rp_mode_reply_to",
} as const;

// The gaps that nobody filled: a reply with one cannot be approved. The labels are the text of the draft (the model's words), shown as text.
function Gaps({ labels }: { labels: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-destructive-soft p-4 text-destructive">
      <h3 className="text-sm font-bold">{t("rp_gaps_title")}</h3>
      <ul className="list-disc pl-5 text-sm">
        {labels.map((label, index) => (
          <li key={`${index}:${label}`} className="break-words">
            {label}
          </li>
        ))}
      </ul>
      <p className="text-sm">{t("rp_gaps_help")}</p>
    </div>
  );
}

// The card of one send: who it goes to, every fact to check before a send, the full draft text and the full quote as plain text
// (line breaks kept), then what the page gives (the decision bar and the messages). A send whose text retention cleared has no view.
// A reply shows its gaps first and says who it goes to.
export function ApprovalCard({ detail, now, titleRef, children }: ApprovalCardProps) {
  const { view } = detail;
  const item = view === null ? null : { ...detail, view };
  // The full quote that the committer would send; the cut quote of the card view only when the route has none.
  const quote = detail.quote ?? view?.quote?.text ?? null;
  const quoteCut = detail.quote === null && view?.quote?.cut === true;
  const decidable = detail.state === "waiting" || detail.state === "held";
  const reply = view?.kind === "reply";
  const endKey = endReasonKey(detail);
  const instruction = detail.instruction ?? null;
  const senderLine = detail.sender === null || detail.sender === undefined ? null : senderLineText(detail.sender);
  return (
    <section aria-label={t("appr_detail_label")} className="min-w-0">
      <Card>
        <CardContent className="flex flex-col gap-4">
          {view === null || item === null ? (
            <>
              <p className="font-bold">{t(stateLabelKey(detail.state, detail.heldBy))}</p>
              <p>{t("appr_no_content")}</p>
            </>
          ) : (
            <>
              {reply && view.gaps !== undefined && view.gaps.length > 0 && <Gaps labels={view.gaps} />}
              <div className="flex items-center gap-3">
                <InitialsAvatar name={recipientName(view)} />
                <h2 ref={titleRef} tabIndex={-1} className="min-w-0 break-words text-lg font-bold outline-none">
                  <ApprovalTitle view={view} />
                </h2>
              </div>
              <ApprovalSummary item={item} now={now} />
              {endKey !== null && <p className="text-sm">{t(endKey)}</p>}
              <p className="break-words text-sm text-muted-foreground">{`${t("appr_mailbox")}: ${detail.mailboxAddress}`}</p>
              {reply && detail.recipientsMode !== undefined && (
                <p className="text-sm">{t(MODE_TEXTS[detail.recipientsMode])}</p>
              )}
              {(senderLine !== null || (reply && instruction !== null)) && (
                <FactBox>
                  <h3 className="text-sm font-bold">{t("appr_about")}</h3>
                  {senderLine !== null && <p className="break-words text-sm">{senderLine}</p>}
                  {reply && instruction !== null && <p className="break-words text-sm">{instruction}</p>}
                </FactBox>
              )}
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-bold">{t("appr_draft")}</h3>
                <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-base">{view.body}</p>
              </div>
              {quote !== null && (
                <details className="flex flex-col gap-1.5">
                  <summary className="cursor-pointer text-sm font-bold">{t("appr_quote")}</summary>
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{quote}</p>
                    {quoteCut && <p className="text-sm text-muted-foreground">{t("appr_quote_cut")}</p>}
                  </div>
                </details>
              )}
              {reply && view.sentVisible === false && <p className="text-sm">{t("rp_sent_hidden")}</p>}
              {decidable && (
                <p className="text-sm text-muted-foreground">
                  {t(copyChecked(view) ? "rp_send_note_editable" : "appr_send_note")}
                </p>
              )}
            </>
          )}
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
