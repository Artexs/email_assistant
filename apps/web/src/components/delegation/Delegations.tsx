import type { DelegationFilter, DelegationItem } from "@ea/core/web";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cancelButtonId, ROW_ID_PREFIX, rowId } from "./DelegationRow";
import { DelegationCancelDialog } from "./DelegationCancelDialog";
import { DelegationFilterTabs } from "./DelegationFilterTabs";
import { ROW_BY_KIND } from "./delegation-kinds";
import { useMe } from "../shell/MeProvider";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { createFocusedRowTracker } from "../../lib/focused-row";
import { postCancel, postDone, postRemind } from "../../lib/delegations-api";
import {
  approvalLink,
  cancelOutcome,
  DELEGATION_REMINDER_LIMIT,
  doneOutcome,
  FILTER_EMPTY,
  remindOutcome,
  type ActionOutcome,
  type DelegationAction,
  type RemindBlock,
} from "../../lib/delegations-view";
import { singleFlight } from "../../lib/single-flight";
import { useDelegationFilter } from "../../lib/use-delegation-filter";
import { useDelegationList } from "../../lib/use-delegation-list";

// The line under the tabs: one live region that holds the text of a result (`info`) or of a failure (`error`), with a link when the
// result has a next step. The focus goes to this element after each action, so the text must sit inside it.
interface Notice {
  tone: "info" | "error";
  key: TextKey;
  name?: string;
  link?: { href: string; key: TextKey };
}

// `max` fills the limit text of Remind now (the other texts have no such place).
function noticeText(notice: Notice): string {
  return t(notice.key, { max: DELEGATION_REMINDER_LIMIT, name: notice.name ?? "" });
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

// Where the focus goes when the cancel question closes: the Cancel button of the row (the user kept the delegation), or the status
// line (an answer came).
type FocusTarget = "row" | "status";

export interface DelegationsProps {
  // What the page shows under the list, given the filter that the list has now (the tracked loops of the Delegated tab).
  below?: (filter: DelegationFilter) => ReactNode;
}

export function Delegations({ below }: DelegationsProps = {}) {
  const { me, reload: reloadMe } = useMe();
  const [filter, selectFilter] = useDelegationFilter();
  const list = useDelegationList(filter);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The delegation of the open cancel question. It stays in state, not in the list: a reload that drops the row (the delegate answered, someone
  // closed it) must not close the question. Confirm then gets 409 `not_open` and the status line says so.
  const [confirmCancel, setConfirmCancel] = useState<DelegationItem | null>(null);
  // The reason that the server gave for Remind now, per delegation (`drafts_off` is not on the row). A new tab clears them.
  const [blocked, setBlocked] = useState<Record<string, RemindBlock>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [flight] = useState(singleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<FocusTarget>("row");
  const [statusTick, setStatusTick] = useState(0);
  // The effect runs after the commit that removed the pressed button or the dialog, so nothing takes the focus back.
  useEffect(() => {
    if (statusTick > 0) statusRef.current?.focus();
  }, [statusTick]);
  // A reload can remove the row whose button has the focus (the delegation moved to another tab): the browser then puts the focus on the
  // page body. The line of the result gets it instead, with a text that says what happened. The tracker knows the row that holds the
  // focus; it forgets the row when the user moves the focus to nothing, so a later reload takes no focus without a user action.
  const [focusedRow] = useState(() => createFocusedRowTracker(ROW_ID_PREFIX));
  useEffect(() => {
    document.addEventListener("focusin", focusedRow.onFocusIn);
    document.addEventListener("focusout", focusedRow.onFocusOut);
    return () => {
      document.removeEventListener("focusin", focusedRow.onFocusIn);
      document.removeEventListener("focusout", focusedRow.onFocusOut);
    };
  }, [focusedRow]);
  const loaded = list.data;
  useEffect(() => {
    const id = focusedRow.current;
    if (id === null || loaded === null || loaded.items.some((item) => item.id === id)) return;
    focusedRow.clear();
    if (document.activeElement === null || document.activeElement === document.body) {
      setNotice({ tone: "info", key: "dgn_moved" });
      statusRef.current?.focus();
    }
  }, [loaded, focusedRow]);
  const focusStatus = () => setStatusTick((tick) => tick + 1);

  const changeFilter = (next: typeof filter) => {
    setNotice(null);
    setBlocked({});
    setMoreFailed(false);
    selectFilter(next);
  };

  // The flag is off: the API answers like for an unknown path.
  if (!list.loading && list.error instanceof ApiError && list.error.status === 404) {
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground">{t("dlg_off")}</p>
        </CardContent>
      </Card>
    );
  }

  const owner = me?.role === "owner";
  const writable = canWrite(me);
  const timeZone = me?.organization.timezone ?? "UTC";
  const items = list.data?.items ?? [];

  const refresh = () => {
    list.reload();
    reloadMe();
  };

  const finish = (outcome: ActionOutcome, id: string) => {
    if (outcome.kind === "gone") setNotice({ tone: "error", key: "dgn_gone" });
    else if (outcome.kind === "notice") {
      setNotice({ tone: "info", key: outcome.key });
      const { block } = outcome;
      if (block !== undefined) setBlocked((prev) => ({ ...prev, [id]: block }));
    } else setNotice({ tone: "error", key: outcome.key });
    refresh();
    focusStatus();
  };

  const run = (item: DelegationItem, action: DelegationAction) => {
    if (action === "cancel") {
      focusTarget.current = "row";
      setConfirmCancel(item);
      return;
    }
    void flight(async () => {
      setNotice(null);
      try {
        if (action === "remind") {
          const answer = await postRemind(item.id);
          setNotice({
            tone: "info",
            key: "dgn_reminded",
            link: { href: approvalLink(answer.sendId), key: "dgn_reminded_link" },
          });
        } else {
          await postDone(item.id);
          setNotice({ tone: "info", key: "dgn_done_ok", name: item.delegate.name });
        }
        refresh();
        focusStatus();
      } catch (error) {
        finish(action === "remind" ? remindOutcome(error) : doneOutcome(error), item.id);
      }
    });
  };

  const cancel = (item: DelegationItem) => {
    focusTarget.current = "status";
    setConfirmCancel(null);
    void flight(async () => {
      setNotice(null);
      try {
        await postCancel(item.id);
        setNotice({ tone: "info", key: "dgn_cancelled", name: item.delegate.name });
        refresh();
        focusStatus();
      } catch (error) {
        finish(cancelOutcome(error), item.id);
      }
    });
  };

  const showMore = () => {
    void flight(async () => {
      setLoadingMore(true);
      setMoreFailed(false);
      try {
        const added = await list.showMore();
        const first = added[0];
        // The button may leave with the last page: the focus goes to the first new row, which stays.
        if (first !== undefined) requestAnimationFrame(() => document.getElementById(rowId(first.id))?.focus());
      } catch {
        setMoreFailed(true);
      } finally {
        setLoadingMore(false);
      }
    });
  };

  // The row can be gone when the question closes (a reload dropped it): the status line takes the focus then, never the page body.
  const returnFocus = (id: string) => {
    const answered = focusTarget.current === "status";
    const button = answered ? null : document.getElementById(cancelButtonId(id));
    if (button !== null) button.focus();
    else {
      if (!answered) setNotice({ tone: "info", key: "dgn_moved" });
      statusRef.current?.focus();
    }
    focusTarget.current = "row";
  };

  let listContent;
  if (list.data === null) {
    listContent =
      list.error === null || list.loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p>{t("dgn_load_error")}</p>
          <Button onClick={list.reload}>{t("retry")}</Button>
        </div>
      );
  } else if (items.length === 0) {
    listContent = <p className="text-sm text-muted-foreground">{t(FILTER_EMPTY[filter])}</p>;
  } else {
    listContent = (
      <ul aria-label={t("dgn_list_label")} className="flex flex-col gap-3">
        {items.map((item) => {
          const Row = ROW_BY_KIND[item.kind];
          return (
            <Row
              key={item.id}
              item={item}
              owner={owner}
              canWrite={writable}
              timeZone={timeZone}
              blocked={blocked[item.id]}
              onAction={run}
            />
          );
        })}
      </ul>
    );
  }

  const cancelling = confirmCancel;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <DelegationFilterTabs current={filter} onSelect={changeFilter} />
      <div
        role="status"
        tabIndex={-1}
        ref={statusRef}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {notice !== null && (
          <p className={notice.tone === "error" ? "rounded-md border px-4 py-3 text-sm text-destructive" : "text-sm"}>
            {noticeText(notice)}
            {notice.link !== undefined && (
              <>
                {" "}
                <a href={notice.link.href} className="underline">
                  {t(notice.link.key)}
                </a>
              </>
            )}
          </p>
        )}
      </div>
      {me !== null && !owner && <p className="text-sm text-muted-foreground">{t("dgn_owner_only")}</p>}
      {listContent}
      {list.data !== null && list.data.next !== null && (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={showMore}>
            {t("dgn_more")}
          </Button>
          {moreFailed && <p className="text-sm text-destructive">{t("dgn_more_error")}</p>}
        </div>
      )}
      {below?.(filter)}
      {cancelling !== null && (
        <DelegationCancelDialog
          item={cancelling}
          onKeep={() => setConfirmCancel(null)}
          onConfirm={() => cancel(cancelling)}
          onReturnFocus={() => returnFocus(cancelling.id)}
        />
      )}
    </div>
  );
}
