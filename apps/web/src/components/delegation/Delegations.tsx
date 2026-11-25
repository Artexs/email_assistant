import type { DelegationItem } from "@ea/core/web";
import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";

import { cancelButtonId, ROW_ID_PREFIX, rowId } from "./DelegationRow";
import { DelegationCancelDialog } from "./DelegationCancelDialog";
import { DelegationColumn, type ColumnHint } from "./DelegationColumn";
import { ROW_BY_KIND } from "./delegation-kinds";
import { FactBox } from "../patterns/FactBox";
import { EmptyState } from "../patterns/EmptyState";
import { useMe } from "../shell/MeProvider";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { t, type TextKey } from "../../i18n";
import { canWrite } from "../../lib/can-write";
import {
  CLOSED_LOOK,
  COLUMN_LOOK,
  DELEGATION_COLUMNS,
  focusAfterReload,
  GROUP_FEED,
  type DelegationGroup,
} from "../../lib/delegation-columns";
import { createFocusedRowTracker } from "../../lib/focused-row";
import { postCancel, postDone, postRemind } from "../../lib/delegations-api";
import {
  approvalLink,
  cancelOutcome,
  closedOnLoad,
  DELEGATION_REMINDER_LIMIT,
  doneOutcome,
  remindOutcome,
  type ActionOutcome,
  type DelegationAction,
  type RemindBlock,
} from "../../lib/delegations-view";
import { singleFlight } from "../../lib/single-flight";
import { useDelegationColumns } from "../../lib/use-delegation-columns";

// The line above the columns: one live region that holds the text of a result (`info`) or of a failure (`error`), with a link when the
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

const CLOSED_LIST_ID = "delegation-closed-list";
const headingIdOf = (group: DelegationGroup): string => `delegation-col-${group}`;

export function Delegations() {
  const { me, reload: reloadMe } = useMe();
  // `?filter=closed` opens the closed list once, at load (the page writes no address).
  const [closedOpen, setClosedOpen] = useState(() => closedOnLoad(location.search));
  const columns = useDelegationColumns({ closedOpen });
  const { feeds, groups } = columns;
  const [notice, setNotice] = useState<Notice | null>(null);
  // The delegation of the open cancel question. It stays in state, not in a column: a reload that drops the row (the delegate answered, someone
  // closed it) must not close the question. Confirm then gets 409 `not_open` and the status line says so.
  const [confirmCancel, setConfirmCancel] = useState<DelegationItem | null>(null);
  // The reason that the server gave for Remind now, per delegation (`drafts_off` is not on the row).
  const [blocked, setBlocked] = useState<Record<string, RemindBlock>>({});
  const [loadingMore, setLoadingMore] = useState<DelegationGroup | null>(null);
  // The group whose last "Show more" came back with no new row before the limit of pages for one click.
  const [capped, setCapped] = useState<DelegationGroup | null>(null);
  const [flight] = useState(singleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<FocusTarget>("row");
  const [statusTick, setStatusTick] = useState(0);
  // The effect runs after the commit that removed the pressed button or the dialog, so nothing takes the focus back.
  useEffect(() => {
    if (statusTick > 0) statusRef.current?.focus();
  }, [statusTick]);
  // The address asked for the closed list: it scrolls into view once, when its rows are there.
  const scrollToClosed = useRef(closedOpen);
  const closedLoaded = feeds.closed !== undefined;
  useEffect(() => {
    if (!scrollToClosed.current || !closedLoaded) return;
    scrollToClosed.current = false;
    closedRef.current?.scrollIntoView({ block: "start" });
  }, [closedLoaded]);
  // The groups that the page shows: the closed rows count only while their list is open.
  const shown: Record<DelegationGroup, DelegationItem[]> = { ...groups, closed: closedOpen ? groups.closed : [] };
  // A reload can move the row whose control has the focus to another column, or take it out of every group (the delegation closed, and its
  // list is shut). A moved row keeps the focus on its new card. A row that is gone gives the focus to the line of the result, with a text
  // that says what happened, never to the page body. The tracker knows the row that holds the focus; it forgets the row when the user moves
  // the focus to nothing, so a later reload takes no focus without a user action.
  const [focusedRow] = useState(() => createFocusedRowTracker(ROW_ID_PREFIX));
  useEffect(() => {
    document.addEventListener("focusin", focusedRow.onFocusIn);
    document.addEventListener("focusout", focusedRow.onFocusOut);
    return () => {
      document.removeEventListener("focusin", focusedRow.onFocusIn);
      document.removeEventListener("focusout", focusedRow.onFocusOut);
    };
  }, [focusedRow]);
  const loaded = Object.keys(feeds).length > 0;
  useEffect(() => {
    const id = focusedRow.current;
    if (id === null || !loaded) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    const verdict = focusAfterReload(id, closedOpen ? groups : { ...groups, closed: [] });
    if (verdict === "row") {
      if (lost) document.getElementById(rowId(id))?.focus();
      return;
    }
    focusedRow.clear();
    if (lost) {
      setNotice({ tone: "info", key: "dgn_moved" });
      statusRef.current?.focus();
    }
  }, [groups, closedOpen, loaded, focusedRow]);
  const focusStatus = () => setStatusTick((tick) => tick + 1);

  // The flag is off: the API answers like for an unknown path.
  if (columns.flagOff) {
    return <FactBox>{t("dlg_off")}</FactBox>;
  }

  const owner = me?.role === "owner";
  const writable = canWrite(me);
  const timeZone = me?.organization.timezone ?? "UTC";

  const refresh = () => {
    columns.reload();
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

  // "Show more" of one group. A new row takes the focus (the button may leave with the last page). No new row at the end of the list: the
  // line of the result says so and takes the focus. No new row before the end (the limit of pages for one click): a text says to press
  // again, and the focus stays on the button.
  const showMore = (group: DelegationGroup) => {
    void flight(async () => {
      setLoadingMore(group);
      setCapped(null);
      try {
        const { added, ended, failed } = await columns.showMore(group);
        const first = added[0];
        if (first !== undefined) requestAnimationFrame(() => document.getElementById(rowId(first.id))?.focus());
        else if (!failed && ended) {
          setNotice({ tone: "info", key: "dgn_col_no_more" });
          focusStatus();
        } else if (!failed) setCapped(group);
      } finally {
        setLoadingMore(null);
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

  const cardOf = (item: DelegationItem, showStatus: boolean) => {
    const Row = ROW_BY_KIND[item.kind];
    return (
      <Row
        key={item.id}
        item={item}
        owner={owner}
        canWrite={writable}
        timeZone={timeZone}
        blocked={blocked[item.id]}
        showStatus={showStatus}
        onAction={run}
      />
    );
  };

  const hintOf = (group: DelegationGroup): ColumnHint | null => {
    if (capped === group) return { text: t("dgn_col_capped"), error: false };
    const feed = feeds[GROUP_FEED[group]];
    return feed !== undefined && feed.error !== null && feed.items.length > 0
      ? { text: t("dgn_more_error"), error: true }
      : null;
  };

  const columnOf = (group: DelegationGroup, look: typeof CLOSED_LOOK) => {
    const feed = feeds[GROUP_FEED[group]];
    return (
      <DelegationColumn
        key={group}
        headingId={headingIdOf(group)}
        title={t(look.title)}
        icon={look.icon}
        tone={look.tone}
        empty={t(look.empty)}
        items={shown[group]}
        next={feed?.next ?? null}
        failed={feed !== undefined && feed.error !== null && feed.items.length === 0}
        loadingMore={loadingMore === group}
        hint={hintOf(group)}
        renderRow={(item) => cardOf(item, group === "closed")}
        onMore={() => showMore(group)}
        onRetry={() => columns.retry(GROUP_FEED[group])}
      />
    );
  };

  // Nothing to show in any column and every list reached its end: one empty state takes the place of the four empty columns.
  const nothing =
    DELEGATION_COLUMNS.every((column) => shown[column].length === 0) &&
    (["open", "overdue", "answered"] as const).every((filter) => {
      const feed = feeds[filter];
      return feed !== undefined && feed.next === null && feed.error === null;
    });

  let columnsContent;
  if (!loaded) columnsContent = <Loading />;
  else if (nothing) {
    columnsContent = <EmptyState icon={Users} title={t("dgn_none_title")} text={t("dgn_none_text")} />;
  } else {
    columnsContent = (
      <div className="grid items-start gap-4 lg:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
        {DELEGATION_COLUMNS.map((column) => columnOf(column, COLUMN_LOOK[column]))}
      </div>
    );
  }

  const cancelling = confirmCancel;
  return (
    <div className="flex flex-col gap-4">
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
      {columnsContent}
      <div className="flex flex-col items-start gap-4">
        <Button
          type="button"
          variant="outline"
          aria-expanded={closedOpen}
          aria-controls={CLOSED_LIST_ID}
          onClick={() => setClosedOpen((open) => !open)}
        >
          {t(closedOpen ? "dgn_closed_hide" : "dgn_closed_show")}
        </Button>
        <div id={CLOSED_LIST_ID} ref={closedRef} className="w-full scroll-mt-4" hidden={!closedOpen}>
          {closedOpen && (closedLoaded ? columnOf("closed", CLOSED_LOOK) : <Loading />)}
        </div>
      </div>
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
