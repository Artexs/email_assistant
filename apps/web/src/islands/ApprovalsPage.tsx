import { useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { cn } from "cn";

import { ApprovalActions, RejectReason } from "../components/approvals/ApprovalActions";
import { ApprovalCard } from "../components/approvals/ApprovalCard";
import { ApprovalEditDialog } from "../components/approvals/ApprovalEditDialog";
import { ReplyControls } from "../components/approvals/ReplyControls";
import { useReplyActions } from "../components/approvals/use-reply-actions";
import { WaitingList } from "../components/approvals/WaitingList";
import { EmptyState } from "../components/patterns/EmptyState";
import { AppShell } from "../components/shell/AppShell";
import { useMe } from "../components/shell/MeProvider";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { t, useLocale, type TextKey } from "../i18n";
import type { Notice } from "../lib/approvals-notice";
import { ApiError } from "../lib/api";
import { fetchApproval, fetchApprovals, postApprove, postReject, postRejectReason } from "../lib/approvals-api";
import { canEdit, editStart } from "../lib/approvals-edit";
import { approvalsLeadText } from "../lib/approvals-lead";
import { approveMessage, decisions, failureOutcome } from "../lib/approvals-view";
import { canWrite } from "../lib/can-write";
import { errorText } from "../lib/errors";
import { singleFlight } from "../lib/single-flight";
import { useNow } from "../lib/use-now";
import { useReloadOn } from "../lib/use-reload-on";
import { useResource } from "../lib/use-resource";
import { useSelectedId } from "../lib/use-selected-id";

const PREPARING_POLL_MS = 5_000;

async function loadDetail(id: string | null) {
  return { id, detail: id === null ? null : await fetchApproval(id) };
}

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
  return t(notice.key);
}

// The line of the result. After an answer the page moves the focus here: the button that the owner pressed is gone (or off), and the
// focus would fall to the page start. The line stays in the page, so the focus stays on a live element.
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
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

// The list reloads every 30 s while the tab is visible. The page holds it above the shell: the lead of the page head counts it.
function useApprovalList() {
  return useResource(fetchApprovals);
}

type ApprovalListResource = ReturnType<typeof useApprovalList>;

function Approvals({ list }: { list: ApprovalListResource }) {
  const { me, reload: reloadMe } = useMe();
  const now = useNow();
  const [id, select] = useSelectedId();
  // An item is loaded once per choice and after each action.
  // A new version (after an edit) has no copy in the mailbox yet: the detail reloads every 5 s until the draft is ready, so Approve turns on.
  // The poll stops while the edit dialog is open: a reload must not replace the item under the typed text (a newer version then
  // answers 409 `changed` on save, and the dialog keeps the text).
  const [preparing, setPreparing] = useState(false);
  // The id of the send whose edit dialog is open.
  const [editing, setEditing] = useState<string | null>(null);
  const detail = useResource(() => loadDetail(id), { pollMs: preparing && editing === null ? PREPARING_POLL_MS : 0 });
  useReloadOn(id, detail.reload);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ id: string; saved: boolean } | null>(null);
  const [flight] = useState(singleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  // The effect runs after the commit that removed the pressed button or the dialog, so nothing takes the focus back.
  useEffect(() => {
    if (focusTick > 0) statusRef.current?.focus();
  }, [focusTick]);
  const focusStatus = () => setFocusTick((tick) => tick + 1);

  // The loaded item counts only for the id that is chosen now.
  const current = detail.data !== null && detail.data.id === id ? detail.data : null;
  const open = current?.detail ?? null;
  const waitsForDraft = open !== null && open.state === "waiting" && !open.draftReady;
  useEffect(() => setPreparing(waitsForDraft), [waitsForDraft]);

  // A replaced version shows the newest one in its place (the URL is replaced, so back does not return to the old one).
  useEffect(() => {
    // While the edit dialog is open the page stays on the item (the typed text is kept; the save answers 409 `changed`).
    if (editing !== null || open === null || open.state !== "superseded" || open.currentId === null) return;
    setNotice({ tone: "info", key: "appr_superseded" });
    select(open.currentId, "replace");
  }, [open, select, editing]);

  // A dialog belongs to one send: another choice closes it.
  useEffect(() => {
    if (editing !== null && editing !== id) setEditing(null);
  }, [editing, id]);

  // The redraft and the recipient choice of a reply. They open the new version in place of this one (the URL is replaced).
  const reply = useReplyActions({
    id,
    open: (next) => select(next, "replace"),
    say: setNotice,
    refresh: () => {
      list.reload();
      reloadMe();
    },
    reloadDetail: detail.reload,
    focusStatus,
  });

  // The flag is off: the API answers like for an unknown path.
  if (!list.loading && list.error instanceof ApiError && list.error.status === 404) {
    return <EmptyState icon={Inbox} title={t("appr_off")} />;
  }

  const refresh = () => {
    list.reload();
    reloadMe();
  };

  const onSelect = (next: string | null) => {
    setNotice(null);
    setReasonFor(null);
    select(next);
  };

  // The edit made a new version (a new send, `waiting`): the page shows it, says it and asks for a new approval.
  const onEdited = (answer: { id: string; version: number }) => {
    setEditing(null);
    setReasonFor(null);
    setNotice({ tone: "info", key: "appr_edit_saved", n: answer.version });
    select(answer.id, "replace");
    refresh();
    focusStatus();
  };

  const onOpenVersion = (currentId: string) => {
    setEditing(null);
    setNotice({ tone: "info", key: "appr_changed" });
    select(currentId, "replace");
    refresh();
    focusStatus();
  };

  // The send closed or vanished while the dialog was open: the item shows its real state after the reload.
  const onClosedSend = (key: TextKey | null) => {
    setEditing(null);
    setNotice(key === null ? { tone: "error", key: "appr_not_found" } : { tone: "info", key });
    detail.reload();
    refresh();
    focusStatus();
  };

  const fail = (error: unknown) => {
    const outcome = failureOutcome(error);
    switch (outcome.kind) {
      case "changed":
        setNotice({ tone: "info", key: "appr_changed" });
        select(outcome.currentId, "replace");
        refresh();
        focusStatus();
        break;
      case "notice":
        setNotice({ tone: "info", key: outcome.key });
        detail.reload();
        refresh();
        focusStatus();
        break;
      case "gone":
        setNotice({ tone: "error", key: "appr_not_found" });
        detail.reload();
        refresh();
        break;
      case "error":
        setNotice({ tone: "error", key: outcome.key });
        break;
    }
  };

  const decide = (target: string, kind: "approve" | "reject") => {
    void flight(async () => {
      setBusy(true);
      setNotice(null);
      try {
        if (kind === "approve") {
          const answer = await postApprove(target);
          // The state and the cause come from the detail, never from the answer alone (a held send also answers `approved`).
          const after = await fetchApproval(target).catch(() => null);
          setNotice({ tone: "info", ...approveMessage(after, answer) });
          if (after === null) detail.reload();
          else detail.mutate({ id: target, detail: after });
        } else {
          await postReject(target);
          setNotice({ tone: "info", key: "appr_done_rejected" });
          if (me?.features.includes("mistake_capture") === true) setReasonFor({ id: target, saved: false });
          detail.reload();
        }
        refresh();
        focusStatus();
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    });
  };

  const onReason = (reason: Parameters<typeof postRejectReason>[1] | null) => {
    if (reasonFor === null) return;
    if (reason === null) {
      setReasonFor(null);
      focusStatus();
      return;
    }
    const target = reasonFor.id;
    void flight(async () => {
      setBusy(true);
      try {
        await postRejectReason(target, reason);
        setReasonFor({ id: target, saved: true });
      } catch (error) {
        setNotice({ tone: "error", key: errorText(error) });
      } finally {
        setBusy(false);
      }
    });
  };

  const items = list.data?.items ?? [];
  let listContent;
  if (list.data === null) {
    listContent =
      list.error === null || list.loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("appr_load_error")}</p>
          <Button onClick={list.reload}>{t("retry")}</Button>
        </div>
      );
  } else {
    listContent = <WaitingList items={items} focusId={id} now={now} onPick={onSelect} />;
  }

  const back = (
    <a
      href="/approvals"
      className="text-sm underline lg:hidden"
      onClick={(event) => {
        event.preventDefault();
        onSelect(null);
      }}
    >
      {t("appr_back")}
    </a>
  );

  let detailContent;
  if (id === null) {
    detailContent = items.length === 0 ? null : <p className="text-sm text-muted-foreground">{t("appr_pick")}</p>;
  } else if (current === null) {
    detailContent =
      detail.error === null || detail.loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("appr_detail_error")}</p>
          <Button onClick={detail.reload}>{t("retry")}</Button>
        </div>
      );
  } else if (open === null) {
    detailContent = (
      <div className="flex flex-col items-start gap-3">
        {back}
        <p>{t("appr_not_found")}</p>
      </div>
    );
  } else {
    const owner = me?.role === "owner";
    const allowed = decisions(open, { owner, canWrite: canWrite(me) });
    // A reply that still has a gap cannot be approved (the server answers 409 `has_gaps`): Approve is off and says why.
    const gaps = open.kind === "reply" ? (open.view?.gaps ?? []) : [];
    detailContent = (
      <div className="flex flex-col gap-4">
        {back}
        <ApprovalCard detail={open} now={now}>
          {open.kind === "reply" && open.state === "waiting" && owner && canWrite(me) && (
            <ReplyControls
              key={open.id}
              detail={open}
              waiting={reply.waiting}
              busy={reply.busy || busy}
              onRedraft={(line) => void reply.redraft(open.id, line)}
              onRecipients={(mode) => void reply.recipients(open.id, mode)}
            />
          )}
          <ApprovalActions
            decisions={allowed}
            draftReady={open.draftReady}
            busy={busy || reply.busy || reply.waiting}
            approveBlock={gaps.length > 0 ? "rp_approve_gaps" : null}
            ownerOnly={me !== null && !owner && (open.state === "waiting" || open.state === "held")}
            canEdit={canEdit(open, { owner, canWrite: canWrite(me) }) && editStart(open) !== null}
            editRef={editButtonRef}
            onApprove={() => decide(open.id, "approve")}
            onReject={() => decide(open.id, "reject")}
            onEdit={() => setEditing(open.id)}
          />
          {editing === open.id && (
            <ApprovalEditDialog
              detail={open}
              onClose={() => setEditing(null)}
              onReturnFocus={() => editButtonRef.current?.focus()}
              onSaved={onEdited}
              onOpenVersion={onOpenVersion}
              onClosedSend={onClosedSend}
            />
          )}
          {reasonFor?.id === open.id &&
            (reasonFor.saved ? (
              <p
                role="status"
                tabIndex={-1}
                // The select that was open is gone: the focus goes to the saved line.
                ref={(line) => line?.focus()}
                className="rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("appr_reason_saved")}
              </p>
            ) : (
              <RejectReason disabled={busy} onPick={onReason} />
            ))}
        </ApprovalCard>
      </div>
    );
  }

  // Nothing waits and no draft is open: one empty state in place of the two columns. An open draft stays after the last decision.
  if (list.data !== null && items.length === 0 && id === null) {
    return (
      <EmptyState icon={Inbox} title={t("appr_none")} text={t("appr_empty_text")}>
        <Button asChild>
          <a href="/activity">{t("appr_empty_action")}</a>
        </Button>
      </EmptyState>
    );
  }

  // The list comes first in the page, so the keyboard picks a draft and then reaches its buttons; from `lg` it sits at the right.
  return (
    <div className="flex flex-col gap-4">
      <NoticeLine notice={notice} statusRef={statusRef} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {(list.data === null || items.length > 0) && (
          <Card className={cn("lg:col-start-2 lg:row-start-1 lg:self-start", id !== null && "hidden lg:flex")}>
            <CardContent className="flex flex-col gap-3">
              <h2 className="text-lg font-bold">{t("appr_up_next")}</h2>
              {listContent}
            </CardContent>
          </Card>
        )}
        <div className={cn("lg:col-start-1 lg:row-start-1", id === null && "hidden lg:block")}>{detailContent}</div>
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
