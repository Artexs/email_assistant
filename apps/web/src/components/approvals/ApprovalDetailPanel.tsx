import type { ApprovalDetail } from "@ea/core/web";
import type { ReactNode } from "react";

import { t } from "../../i18n";
import { stateLabelKey } from "../../lib/approvals-view";
import { copyChecked, endReasonKey } from "../../lib/replies-view";
import { ApprovalSummary, SummaryFooter } from "./ApprovalSummary";

export interface ApprovalDetailPanelProps {
  detail: ApprovalDetail;
  now: Date;
  // The buttons and the messages of the page.
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
    <div className="flex flex-col gap-1 rounded-md border border-foreground p-3">
      <h3 className="text-sm font-semibold">{t("rp_gaps_title")}</h3>
      <ul className="list-disc pl-5 text-sm">
        {labels.map((label, index) => (
          <li key={`${index}:${label}`} className="break-words">
            {label}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">{t("rp_gaps_help")}</p>
    </div>
  );
}

// The detail of one send: the facts of the list item, the mailbox, the full draft text and the full quote as plain text
// (line breaks kept), then the actions that the page gives. A send whose text retention cleared has no view.
// A reply shows its gaps first, who it goes to and the quote closed (a reply quotes the whole mail).
export function ApprovalDetailPanel({ detail, now, children }: ApprovalDetailPanelProps) {
  const { view } = detail;
  const item = view === null ? null : { ...detail, view };
  // The full quote that the committer would send; the cut quote of the card view only when the route has none.
  const quote = detail.quote ?? view?.quote?.text ?? null;
  const quoteCut = detail.quote === null && view?.quote?.cut === true;
  const decidable = detail.state === "waiting" || detail.state === "held";
  const reply = view?.kind === "reply";
  const endKey = endReasonKey(detail);
  const quoteBox = quote !== null && (
    <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">{quote}</p>
  );
  return (
    <section aria-label={t("appr_detail_label")} className="flex min-w-0 flex-col gap-4">
      {view === null || item === null ? (
        <>
          <p className="font-medium">{t(stateLabelKey(detail.state, detail.heldBy))}</p>
          <p>{t("appr_no_content")}</p>
        </>
      ) : (
        <>
          {reply && view.gaps !== undefined && view.gaps.length > 0 && <Gaps labels={view.gaps} />}
          <ApprovalSummary item={item} now={now} titleAs="h2" footer={reply ? "none" : "inline"} />
          {!reply && endKey !== null && <p className="text-sm">{t(endKey)}</p>}
          <p className="break-words text-sm">{`${t("appr_mailbox")}: ${detail.mailboxAddress}`}</p>
          {reply && detail.recipientsMode !== undefined && (
            <p className="text-sm">{t(MODE_TEXTS[detail.recipientsMode])}</p>
          )}
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t("appr_draft")}</h3>
            <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">{view.body}</p>
          </div>
          {quote !== null &&
            (reply ? (
              <details className="flex flex-col gap-1">
                <summary className="cursor-pointer text-sm font-semibold">{t("appr_quote")}</summary>
                <div className="mt-1 flex flex-col gap-1">
                  {quoteBox}
                  {quoteCut && <p className="text-sm text-muted-foreground">{t("appr_quote_cut")}</p>}
                </div>
              </details>
            ) : (
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">{t("appr_quote")}</h3>
                {quoteBox}
                {quoteCut && <p className="text-sm text-muted-foreground">{t("appr_quote_cut")}</p>}
              </div>
            ))}
          {reply && <SummaryFooter item={item} now={now} />}
          {reply && endKey !== null && <p className="text-sm">{t(endKey)}</p>}
          {reply && view.sentVisible === false && <p className="text-sm">{t("rp_sent_hidden")}</p>}
          {decidable && (
            <p className="text-sm text-muted-foreground">
              {t(copyChecked(view) ? "rp_send_note_editable" : "appr_send_note")}
            </p>
          )}
        </>
      )}
      {children}
    </section>
  );
}
