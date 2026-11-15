import type { ApprovalDetail } from "@ea/core/web";
import type { ReactNode } from "react";

import { t } from "../../i18n";
import { stateLabelKey } from "../../lib/approvals-view";
import { ApprovalSummary } from "./ApprovalSummary";

export interface ApprovalDetailPanelProps {
  detail: ApprovalDetail;
  now: Date;
  // The buttons and the messages of the page.
  children: ReactNode;
}

// The detail of one send: the facts of the list item, the mailbox, the full draft text and the full quote as plain text
// (line breaks kept), then the actions that the page gives. A send whose text retention cleared has no view.
export function ApprovalDetailPanel({ detail, now, children }: ApprovalDetailPanelProps) {
  const { view } = detail;
  // The full quote that the committer would send; the cut quote of the card view only when the route has none.
  const quote = detail.quote ?? view?.quote?.text ?? null;
  const quoteCut = detail.quote === null && view?.quote?.cut === true;
  const decidable = detail.state === "waiting" || detail.state === "held";
  return (
    <section aria-label={t("appr_detail_label")} className="flex min-w-0 flex-col gap-4">
      {view === null ? (
        <>
          <p className="font-medium">{t(stateLabelKey(detail.state, detail.heldBy))}</p>
          <p>{t("appr_no_content")}</p>
        </>
      ) : (
        <>
          <ApprovalSummary item={{ ...detail, view }} now={now} titleAs="h2" />
          <p className="break-words text-sm">{`${t("appr_mailbox")}: ${detail.mailboxAddress}`}</p>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t("appr_draft")}</h3>
            <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">{view.body}</p>
          </div>
          {quote !== null && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">{t("appr_quote")}</h3>
              <p className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">{quote}</p>
              {quoteCut && <p className="text-sm text-muted-foreground">{t("appr_quote_cut")}</p>}
            </div>
          )}
          {decidable && <p className="text-sm text-muted-foreground">{t("appr_send_note")}</p>}
        </>
      )}
      {children}
    </section>
  );
}
