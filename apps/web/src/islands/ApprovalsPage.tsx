import { Inbox } from "lucide-react";

import { ApprovalActions, ApprovalOutcome } from "../components/approvals/ApprovalActions";
import { ApprovalCard } from "../components/approvals/ApprovalCard";
import { ApprovalEditDialog } from "../components/approvals/ApprovalEditDialog";
import { QueueHead } from "../components/approvals/QueueHead";
import { ClosedActions, EmptyQueue, EndCard, MissingCard } from "../components/approvals/QueueStates";
import { ReplyControls } from "../components/approvals/ReplyControls";
import { useApprovalsQueue } from "../components/approvals/use-approvals-queue";
import { WaitingList } from "../components/approvals/WaitingList";
import { EmptyState } from "../components/patterns/EmptyState";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale } from "../i18n";
import { ApiError } from "../lib/api";
import { canEdit, editStart } from "../lib/approvals-edit";
import { approvalsLeadText } from "../lib/approvals-lead";
import type { Notice } from "../lib/approvals-notice";
import { closedView } from "../lib/approvals-queue";
import { decisions } from "../lib/approvals-view";
import { canWrite } from "../lib/can-write";
import { useNow } from "../lib/use-now";
import { useResource } from "../lib/use-resource";
import { fetchApprovals } from "../lib/approvals-api";

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function noticeText(notice: Notice | null): string {
  if (notice === null) return "";
  if (notice.reason !== undefined) return t(notice.key, { reason: t(notice.reason) });
  if (notice.n !== undefined) return t(notice.key, { n: notice.n });
  if (notice.to !== undefined) return t(notice.key, { to: notice.to });
  return t(notice.key);
}

// The line of a result that has no decision bar of its own (a conflict, an edit, another device). After an answer the page moves the
// focus here: the button that the owner pressed is gone, and the focus would fall to the page start. The line stays in the page.
function NoticeLine({
  notice,
  statusRef,
}: {
  notice: Notice | null;
  statusRef: React.RefObject<HTMLDivElement | null>;
}) {
  const text = noticeText(notice);
  return (
    <>
      <div
        role="status"
        tabIndex={-1}
        ref={statusRef}
        className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        {notice?.tone === "info" && <p className="text-sm">{text}</p>}
      </div>
      {notice?.tone === "error" && (
        <Alert variant="destructive">
          <AlertDescription>{text}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

function RetryLine({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p>{text}</p>
      <Button onClick={onRetry}>{t("retry")}</Button>
    </div>
  );
}

// The list reloads every 30 s while the tab is visible. The page holds it above the shell: the lead of the page head counts it.
type ApprovalListResource = ReturnType<typeof useApprovalList>;

function useApprovalList() {
  return useResource(fetchApprovals);
}

function Approvals({ list }: { list: ApprovalListResource }) {
  const { me, reload: reloadMe } = useMe();
  const now = useNow();
  const queue = useApprovalsQueue({
    list,
    mistakeCapture: me?.features.includes("mistake_capture") === true,
    fallbackTo: t("appr_to_fallback"),
    now,
    reloadMe,
  });
  const { open, phase, actions, refs } = queue;

  // The flag is off: the API answers like for an unknown path.
  if (!list.loading && list.error instanceof ApiError && list.error.status === 404) {
    return <EmptyState icon={Inbox} title={t("appr_off")} />;
  }
  if (list.data === null) {
    return list.error === null || list.loading ? (
      <Loading />
    ) : (
      <RetryLine text={t("appr_load_error")} onRetry={list.reload} />
    );
  }

  const upNext = <WaitingList items={queue.items} focusId={queue.id} now={now} onPick={actions.pick} />;

  // Nothing waits and no draft is open: one empty state in place of the card.
  if (queue.id === null && queue.waiting === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyQueue />
        {queue.items.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">{t("appr_up_next")}</h2>
              {upNext}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  let main;
  if (queue.id === null) {
    main = queue.allPassed ? <EndCard onShowAgain={actions.showAgain} /> : <Loading />;
  } else if (open === null && queue.current === null) {
    main =
      queue.detail.error === null || queue.detail.loading ? (
        <Loading />
      ) : (
        <RetryLine text={t("appr_detail_error")} onRetry={queue.detail.reload} />
      );
  } else if (open === null) {
    main = <MissingCard onGoWaiting={actions.goWaiting} />;
  } else if (!queue.focusLayout) {
    main = (
      <ApprovalCard detail={open} now={now}>
        <ClosedActions
          newest={closedView(open).newest}
          onOpenNewest={(next) => actions.pick(next)}
          onGoWaiting={actions.goWaiting}
        />
      </ApprovalCard>
    );
  } else {
    const owner = me?.role === "owner";
    const allowed = decisions(open, { owner, canWrite: canWrite(me) });
    // A reply that still has a gap cannot be approved (the server answers 409 `has_gaps`): Yes is off and says why.
    const gaps = open.kind === "reply" ? (open.view?.gaps ?? []) : [];
    const outcome = phase.kind === "outcome" && phase.id === open.id ? phase : null;
    main = (
      <ApprovalCard detail={open} now={now} titleRef={refs.titleRef}>
        {open.kind === "reply" && open.state === "waiting" && owner && canWrite(me) && (
          <ReplyControls
            key={open.id}
            detail={open}
            waiting={queue.reply.waiting}
            busy={queue.reply.busy || phase.kind !== "idle"}
            onRedraft={(line) => void queue.reply.redraft(open.id, line)}
            onRecipients={(mode) => void queue.reply.recipients(open.id, mode)}
          />
        )}
        {outcome === null ? (
          <ApprovalActions
            decisions={allowed}
            draftReady={open.draftReady}
            busy={phase.kind !== "idle" || queue.reply.busy || queue.reply.waiting || !queue.armed}
            expired={queue.expired}
            approveBlock={gaps.length > 0 ? "rp_approve_gaps" : null}
            ownerOnly={me !== null && !owner && (open.state === "waiting" || open.state === "held")}
            canEdit={canEdit(open, { owner, canWrite: canWrite(me) }) && editStart(open) !== null}
            editRef={refs.editButtonRef}
            onApprove={() => actions.decide(open.id, "approve")}
            onReject={() => actions.decide(open.id, "reject")}
            onEdit={() => queue.setEditing(open.id)}
          />
        ) : (
          <ApprovalOutcome
            text={noticeText(outcome.notice)}
            statusRef={refs.outcomeRef}
            onNext={outcome.then === "next-button" ? () => actions.next(open.id) : undefined}
            reason={
              outcome.then === "reason"
                ? { saved: outcome.saved, busy: queue.reasonBusy, onPick: actions.pickReason }
                : null
            }
          />
        )}
        {queue.editing === open.id && (
          <ApprovalEditDialog
            detail={open}
            onClose={() => queue.setEditing(null)}
            onReturnFocus={() => refs.editButtonRef.current?.focus()}
            onSaved={actions.edited}
            onOpenVersion={actions.openVersion}
            onClosedSend={actions.closedSend}
          />
        )}
      </ApprovalCard>
    );
  }

  // The card comes first in the page, so the keyboard reaches its buttons; from `lg` the list sits at the right.
  return (
    <div className="flex flex-col gap-4">
      <NoticeLine notice={queue.notice} statusRef={refs.statusRef} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
          <QueueHead
            step={queue.inQueue ? queue.step : null}
            laterOff={phase.kind !== "idle"}
            items={queue.items}
            focusId={queue.id}
            now={now}
            waiting={queue.waiting}
            onLater={actions.later}
            onPick={actions.pick}
          />
          {main}
        </div>
        <Card className="hidden lg:col-start-2 lg:row-start-1 lg:flex lg:self-start">
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">{t("appr_up_next")}</h2>
            {upNext}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  useLocale();
  const list = useApprovalList();
  const items = list.data?.items ?? [];
  // No lead while the list loads or the flag is off (the API answers 404).
  const lead = list.data === null ? undefined : { text: approvalsLeadText(items) };
  return (
    <AppShell active="approvals" title="title_approvals" lead={lead}>
      <Approvals list={list} />
    </AppShell>
  );
}
