import type { LoopFilterName, LoopItem, LoopKindName } from "@ea/core/web";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { dateLocale, t, type TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { canWrite } from "../../lib/can-write";
import { approvalLink, dueText } from "../../lib/delegations-view";
import { createFocusedRowTracker } from "../../lib/focused-row";
import { postFollowUp, postLater, postLoopOk } from "../../lib/loops-api";
import {
  LOOP_FILTER_EMPTY,
  LOOP_LIST_LABELS,
  loopName,
  loopOutcome,
  type LoopAction,
  type LoopOutcome,
} from "../../lib/loops-view";
import { singleFlight } from "../../lib/single-flight";
import { useLoopList } from "../../lib/use-loop-list";
import { useMe } from "../shell/MeProvider";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { LoopConfirmDialog } from "./LoopConfirmDialog";
import { loopButtonId, LOOP_ROW_ID_PREFIX, loopRowId } from "./LoopRow";
import { LOOP_ROW_BY_KIND } from "./loop-kinds";

// The line under the tabs: one live region that holds the text of a result (`info`) or of a failure (`error`), with a link when the
// result has a next step. The focus goes to this element after each action, so the text must sit inside it.
interface Notice {
  tone: "info" | "error";
  key: TextKey;
  vars?: Record<string, string>;
  link?: { href: string; key: TextKey };
}

interface Confirm {
  item: LoopItem;
  action: "drop" | "untrack";
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

const OK_TEXTS: Record<"done" | "drop" | "untrack" | "reopen", TextKey> = {
  done: "lp_ok_done",
  drop: "lp_ok_drop",
  untrack: "lp_ok_untrack",
  reopen: "lp_ok_reopen",
};

export interface LoopsBoardProps {
  kind: LoopKindName;
  filter: LoopFilterName;
  // The state links of the tab (Open, Due today, Closed).
  filterNav?: ReactNode;
  // A visible heading over the list (the Delegated tab, where it follows the delegations list).
  showHeading?: boolean;
}

// One list of loops of one kind with its actions. The loop commands are routes of the loops module; every answer reloads the list.
export function LoopsBoard({ kind, filter, filterNav, showHeading = false }: LoopsBoardProps) {
  const { me, reload: reloadMe } = useMe();
  const list = useLoopList(kind, filter);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The loop of the open confirm question. It stays in state, not in the list: a reload that drops the row must not close the question.
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [flight] = useState(singleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<"row" | "status">("row");
  const [statusTick, setStatusTick] = useState(0);
  // The effect runs after the commit that removed the pressed button or the dialog, so nothing takes the focus back.
  useEffect(() => {
    if (statusTick > 0) statusRef.current?.focus();
  }, [statusTick]);
  // A new list (another tab or filter) starts without the result line of the old one.
  useEffect(() => {
    setNotice(null);
    setMoreFailed(false);
  }, [kind, filter]);
  // A reload can remove the row whose button has the focus (the loop moved to another tab): the focus goes to the status line then.
  const [focusedRow] = useState(() => createFocusedRowTracker(LOOP_ROW_ID_PREFIX));
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
      setNotice({ tone: "info", key: "lp_moved" });
      statusRef.current?.focus();
    }
  }, [loaded, focusedRow]);
  const focusStatus = () => setStatusTick((tick) => tick + 1);
  // The reason line counts working days up to the time of the render.
  const now = new Date();

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

  const finish = (outcome: LoopOutcome) => {
    if (outcome.kind === "gone") setNotice({ tone: "error", key: "lp_gone" });
    else setNotice({ tone: outcome.kind === "notice" ? "info" : "error", key: outcome.key });
    refresh();
    focusStatus();
  };

  // The call of one action and the text of its success.
  const perform = async (item: LoopItem, action: LoopAction): Promise<Notice> => {
    if (action === "follow_up") {
      const answer = await postFollowUp(item.id);
      if (answer.status === "would_draft") return { tone: "info", key: "lp_ok_would_draft" };
      return {
        tone: "info",
        key: "lp_ok_follow_up",
        link: { href: approvalLink(answer.sendId), key: "lp_follow_up_link" },
      };
    }
    if (action === "later") {
      const answer = await postLater(item.id);
      return { tone: "info", key: "lp_ok_later", vars: { date: dueText(answer.dueAt, timeZone, dateLocale()) } };
    }
    await postLoopOk(item.id, action);
    return { tone: "info", key: OK_TEXTS[action] };
  };

  const execute = (item: LoopItem, action: LoopAction) =>
    flight(async () => {
      setNotice(null);
      try {
        setNotice(await perform(item, action));
        refresh();
        focusStatus();
      } catch (error) {
        finish(loopOutcome(action, error));
      }
    });

  const run = (item: LoopItem, action: LoopAction) => {
    if (action === "drop" || action === "untrack") {
      focusTarget.current = "row";
      setConfirm({ item, action });
      return;
    }
    void execute(item, action);
  };

  const confirmed = (question: Confirm) => {
    focusTarget.current = "status";
    setConfirm(null);
    void execute(question.item, question.action);
  };

  const showMore = () => {
    void flight(async () => {
      setLoadingMore(true);
      setMoreFailed(false);
      try {
        const added = await list.showMore();
        const first = added[0];
        // The button may leave with the last page: the focus goes to the first new row, which stays.
        if (first !== undefined) requestAnimationFrame(() => document.getElementById(loopRowId(first.id))?.focus());
      } catch {
        setMoreFailed(true);
      } finally {
        setLoadingMore(false);
      }
    });
  };

  // The row can be gone when the question closes (a reload dropped it): the status line takes the focus then, never the page body.
  const returnFocus = (question: Confirm) => {
    const answered = focusTarget.current === "status";
    const button = answered ? null : document.getElementById(loopButtonId(question.item.id, question.action));
    if (button !== null) button.focus();
    else {
      if (!answered) setNotice({ tone: "info", key: "lp_moved" });
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
          <p>{t("lp_load_error")}</p>
          <Button onClick={list.reload}>{t("retry")}</Button>
        </div>
      );
  } else if (items.length === 0) {
    listContent = <p className="text-sm text-muted-foreground">{t(LOOP_FILTER_EMPTY[filter])}</p>;
  } else {
    const Row = LOOP_ROW_BY_KIND[kind];
    listContent = (
      <ul aria-label={t(LOOP_LIST_LABELS[kind])} className="flex flex-col gap-3">
        {items.map((item) => (
          <Row
            key={item.id}
            item={item}
            owner={owner}
            canWrite={writable}
            timeZone={timeZone}
            now={now}
            onAction={run}
          />
        ))}
      </ul>
    );
  }

  const question = confirm;
  return (
    <section aria-label={t(LOOP_LIST_LABELS[kind])} className="flex flex-col gap-4">
      {showHeading && <h2 className="text-base font-semibold">{t(LOOP_LIST_LABELS[kind])}</h2>}
      {filterNav}
      <div
        role="status"
        tabIndex={-1}
        ref={statusRef}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {notice !== null && (
          <p className={notice.tone === "error" ? "rounded-md border px-4 py-3 text-sm text-destructive" : "text-sm"}>
            {t(notice.key, notice.vars)}
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
      {me !== null && !owner && <p className="text-sm text-muted-foreground">{t("lp_owner_only")}</p>}
      {listContent}
      {list.data !== null && list.data.next !== null && (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" disabled={loadingMore} onClick={showMore}>
            {t("dgn_more")}
          </Button>
          {moreFailed && <p className="text-sm text-destructive">{t("lp_more_error")}</p>}
        </div>
      )}
      {question !== null && (
        <LoopConfirmDialog
          action={question.action}
          name={loopName(question.item)}
          onKeep={() => setConfirm(null)}
          onConfirm={() => confirmed(question)}
          onReturnFocus={() => returnFocus(question)}
        />
      )}
    </section>
  );
}
