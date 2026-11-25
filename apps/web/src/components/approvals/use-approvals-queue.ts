import type { ApprovalDetail } from "@ea/core/web";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TextKey } from "../../i18n";
import { ApiError } from "../../lib/api";
import { fetchApproval, postApprove, postReject, postRejectReason } from "../../lib/approvals-api";
import type { Notice } from "../../lib/approvals-notice";
import {
  closedSendKey,
  expiredNow,
  isClosedSendKey,
  nextFocus,
  outcomeOf,
  progress,
  queueIds,
  SENT_HOLD_MS,
  vanished,
  type DecisionResult,
} from "../../lib/approvals-queue";
import { failureOutcome } from "../../lib/approvals-view";
import { singleFlight } from "../../lib/single-flight";
import { useReloadOn } from "../../lib/use-reload-on";
import { useResource } from "../../lib/use-resource";
import { useSelectedId } from "../../lib/use-selected-id";
import { recipientName } from "./ApprovalSummary";
import { failureKey, isPhone, loadDetail, noticeOf, useArmed, type Phase, type QueueList } from "./queue-support";
import { useReplyActions } from "./use-reply-actions";

const PREPARING_POLL_MS = 5_000;

export interface QueueDeps {
  list: QueueList;
  mistakeCapture: boolean;
  fallbackTo: string;
  now: Date;
  reloadMe(): void;
}

// The one-draft-at-a-time queue of the approvals page: which draft is open, what the decision bar shows, what happens after a
// decision and when another device decided the draft. The rules are in `lib/approvals-queue.ts`; this hook holds the state and the timers.
export function useApprovalsQueue({ list, mistakeCapture, fallbackTo, now, reloadMe }: QueueDeps) {
  const [id, select] = useSelectedId();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [ownIds, setOwnIds] = useState<ReadonlySet<string>>(() => new Set());
  const [done, setDone] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [reasonBusy, setReasonBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [openedAs, setOpenedAs] = useState<{ id: string; as: "waiting" | "held" } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [flight] = useState(singleFlight);
  const statusRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  // The next card takes the focus on its title; the page sets this when the user, or a timer, changed the card.
  const titleFocus = useRef(false);
  const handled = useRef<string | null>(null);

  const items = list.data?.items ?? [];
  const detail = useResource(() => loadDetail(id), { pollMs: preparing && editing === null ? PREPARING_POLL_MS : 0 });
  useReloadOn(id, detail.reload);
  const current = detail.data !== null && detail.data.id === id ? detail.data : null;
  const open: ApprovalDetail | null = current?.detail ?? null;
  const openId = open?.id ?? null;
  const decidable = open !== null && (open.state === "waiting" || open.state === "held");

  // Handlers that run after an await or in a timer read the page as it is then, not as it was when they started.
  const live = useRef({ id, items, skipped, ownIds, open, toName: fallbackTo });
  useEffect(() => {
    live.current = {
      id,
      items,
      skipped,
      ownIds,
      open,
      toName: open?.view == null ? fallbackTo : recipientName(open.view),
    };
  });

  const own = useCallback((...ids: string[]) => setOwnIds((prev) => new Set([...prev, ...ids])), []);
  const refresh = useCallback(() => {
    list.reload();
    reloadMe();
  }, [list, reloadMe]);

  // The effect runs after the commit that changed the bar, so the element that takes the focus exists.
  useEffect(() => {
    if (focusTick > 0) (outcomeRef.current ?? statusRef.current)?.focus();
  }, [focusTick]);
  const focusStatus = useCallback(() => setFocusTick((tick) => tick + 1), []);

  const showCard = useCallback(
    (next: string | null, mode: "push" | "replace" = "replace") => {
      titleFocus.current = true;
      select(next, mode);
    },
    [select]
  );

  const moveOn = useCallback(
    (from: string) => {
      const state = live.current;
      setPhase({ kind: "idle" });
      if (state.id !== from) return;
      showCard(
        nextFocus(state.items, { leaving: from, skipped: state.skipped, ownIds: new Set([...state.ownIds, from]) })
      );
    },
    [showCard]
  );

  // A new card takes the focus on its title and, on a phone, scrolls to the top.
  useEffect(() => {
    if (!titleFocus.current || openId === null) return;
    titleFocus.current = false;
    titleRef.current?.focus();
    if (isPhone()) window.scrollTo({ top: 0 });
  }, [openId]);

  // No draft is chosen: the first one that is not skipped opens. The URL is replaced (back leaves the page).
  const first = list.data === null ? null : nextFocus(items, { leaving: null, skipped, ownIds });
  useEffect(() => {
    if (id === null && first !== null && phase.kind === "idle") select(first, "replace");
  }, [id, first, phase.kind, select]);

  // A new version has no copy in the mailbox yet: the detail reloads every 5 s until the draft is ready.
  const waitsForDraft = open !== null && open.state === "waiting" && !open.draftReady;
  useEffect(() => setPreparing(waitsForDraft), [waitsForDraft]);

  // A dialog belongs to one send: another choice closes it.
  useEffect(() => {
    if (editing !== null && editing !== id) setEditing(null);
  }, [editing, id]);

  // What this card was when the page first showed it. A closed draft opened by its link has none.
  useEffect(() => {
    if (open === null || openedAs?.id === open.id) return;
    setOpenedAs(open.state === "waiting" || open.state === "held" ? { id: open.id, as: open.state } : null);
  }, [open, openedAs]);

  const armedNow = useArmed(openId);

  // The expiry time passed while the card is open: Yes and No go off and the card reads its state.
  const expired = decidable && expiredNow(open, now);
  const reloadDetail = detail.reload;
  useEffect(() => {
    if (expired) reloadDetail();
  }, [expired, openId, reloadDetail]);

  const reply = useReplyActions({
    id,
    open: (next) => {
      if (id !== null) own(id);
      select(next, "replace");
    },
    say: setNotice,
    refresh,
    reloadDetail: detail.reload,
    focusStatus,
  });

  // The hold after an outcome ends: the next draft opens.
  useEffect(() => {
    if (phase.kind !== "outcome") return;
    if (phase.then !== "hold" && !phase.saved) return;
    const target = phase.id;
    const timer = setTimeout(() => moveOn(target), SENT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase, moveOn]);

  // Another device decided or replaced the draft that this page shows: say what happened and move on. The poll and the tab turning
  // visible reload the list. An open dialog, a reason question and a redraft in progress decide for themselves first.
  const settled = editing === null && phase.kind === "idle" && !reply.busy && !reply.waiting && !list.loading;
  const elsewhere =
    settled &&
    id !== null &&
    openedAs?.id === id &&
    !ownIds.has(id) &&
    ((open !== null && open.id === id && open.state !== openedAs.as) ||
      (list.data !== null && vanished(items, { id, openedAs: openedAs.as }, ownIds)));
  const leave = useRef<(target: string, was: "waiting" | "held") => Promise<void>>(async () => undefined);
  useEffect(() => {
    leave.current = async (target, was) => {
      const read = await fetchApproval(target).then(
        (value) => ({ value }),
        () => null
      );
      if (read === null || live.current.id !== target) {
        handled.current = null;
        return;
      }
      const after = read.value;
      // The list was behind the card (a reload is on its way): the draft is still as this page showed it.
      if (after !== null && after.state === was) {
        handled.current = null;
        return;
      }
      own(target);
      refresh();
      focusStatus();
      if (after?.state === "superseded" && after.currentId !== null) {
        setNotice({ tone: "info", key: "appr_superseded" });
        select(after.currentId, "replace");
        return;
      }
      const key: TextKey = after === null ? "appr_not_found" : (closedSendKey(after.state) ?? "appr_closed_other");
      setNotice({ tone: "info", key });
      moveOn(target);
    };
  });
  const wasAs = openedAs?.as ?? null;
  useEffect(() => {
    if (!elsewhere || id === null || wasAs === null || handled.current === id) return;
    handled.current = id;
    void leave.current(id, wasAs);
  }, [elsewhere, id, wasAs]);

  const applyOutcome = (target: string, result: DecisionResult) => {
    const outcome = outcomeOf(result);
    const failure = result.kind === "failed" ? failureOutcome(result.error) : null;
    if (result.kind !== "failed" || outcome.then === "hold") own(target);
    if (result.kind !== "failed") setDone((count) => count + 1);
    refresh();
    focusStatus();
    const message = noticeOf(outcome.text, live.current.toName);
    if (outcome.openId !== undefined) {
      own(target);
      setPhase({ kind: "idle" });
      setNotice(message);
      select(outcome.openId, "replace");
      return;
    }
    if (outcome.then === "stay") {
      setPhase({ kind: "idle" });
      setNotice({ ...message, tone: failure?.kind === "error" ? "error" : "info" });
      if (failure?.kind !== "error") detail.reload();
      return;
    }
    setPhase({ kind: "outcome", id: target, notice: message, then: outcome.then, saved: false });
  };

  // A handler takes the id of the card that was on screen when the tap was made; a tap on another card does nothing.
  const decide = (target: string, kind: "approve" | "reject") => {
    if (target !== live.current.id) return;
    void flight(async () => {
      setPhase({ kind: "deciding", id: target });
      setNotice(null);
      let result: DecisionResult;
      try {
        if (kind === "approve") {
          const answer = await postApprove(target);
          // The state and the cause come from the detail, never from the answer alone (a held send also answers `approved`).
          const after = await fetchApproval(target).catch(() => null);
          if (after !== null) detail.mutate({ id: target, detail: after });
          result = { kind: "approved", answer, detail: after };
        } else {
          await postReject(target);
          detail.reload();
          result = { kind: "rejected", mistakeCapture };
        }
      } catch (error) {
        result = { kind: "failed", error };
      }
      applyOutcome(target, result);
    });
  };

  const pickReason = (reason: Parameters<typeof postRejectReason>[1] | null) => {
    if (phase.kind !== "outcome" || phase.then !== "reason") return;
    const target = phase.id;
    if (reason === null) {
      setPhase({ ...phase, then: "hold" });
      focusStatus();
      return;
    }
    void flight(async () => {
      setReasonBusy(true);
      try {
        await postRejectReason(target, reason);
        setPhase((prev) => (prev.kind === "outcome" && prev.id === target ? { ...prev, saved: true } : prev));
      } catch (error) {
        setNotice({
          tone: "error",
          key: failureOutcome(error).kind === "error" ? failureKey(error) : "appr_not_found",
        });
      } finally {
        setReasonBusy(false);
      }
    });
  };

  const later = () => {
    if (id === null || phase.kind !== "idle") return;
    const passed = [...skipped, id];
    setSkipped(passed);
    setNotice(null);
    showCard(nextFocus(items, { leaving: id, skipped: passed, ownIds }));
  };

  const showAgain = () => {
    setSkipped([]);
    showCard(queueIds(items, [], ownIds)[0] ?? null);
  };

  const pick = (next: string | null) => {
    setNotice(null);
    setPhase({ kind: "idle" });
    showCard(next);
  };

  const edited = (answer: { id: string; version: number }) => {
    if (editing !== null) own(editing);
    setEditing(null);
    setNotice({ tone: "info", key: "appr_edit_saved", n: answer.version });
    select(answer.id, "replace");
    refresh();
    focusStatus();
  };

  const openVersion = (currentId: string) => {
    if (editing !== null) own(editing);
    setEditing(null);
    setNotice({ tone: "info", key: "appr_changed" });
    select(currentId, "replace");
    refresh();
    focusStatus();
  };

  // The send closed or vanished while the dialog was open. A send that left the queue shows its text, then the next draft comes; a
  // text that only says the draft cannot be edited keeps the card.
  const closedSend = (key: TextKey | null) => {
    const target = editing;
    setEditing(null);
    refresh();
    focusStatus();
    if (target !== null && key !== null && isClosedSendKey(key)) {
      own(target);
      detail.reload();
      setPhase({ kind: "outcome", id: target, notice: { tone: "info", key }, then: "hold", saved: false });
      return;
    }
    setNotice(key === null ? { tone: "error", key: "appr_not_found" } : { tone: "info", key });
    detail.reload();
  };

  const waiting = queueIds(items, [], ownIds).length;
  const shown = items.filter((item) => !ownIds.has(item.id));
  return {
    id,
    items: shown,
    detail,
    current,
    open,
    // The card has the decision layout: its draft waits, or this page showed it as a waiting draft and has just decided it.
    focusLayout: open !== null && (decidable || openedAs?.id === open.id),
    // The card is a waiting draft of the queue (a held send is no part of it): the step dots and "Later" show.
    inQueue: open !== null && openedAs?.id === open.id && openedAs.as === "waiting",
    expired,
    step: progress({ done, waiting }),
    waiting,
    allPassed: id === null && waiting > 0 && first === null,
    armed: armedNow,
    phase,
    notice,
    setNotice,
    editing,
    setEditing,
    reasonBusy,
    reply,
    refs: { statusRef, outcomeRef, titleRef, editButtonRef },
    actions: {
      decide,
      pickReason,
      later,
      showAgain,
      pick,
      next: (from: string) => moveOn(from),
      goWaiting: () => pick(null),
      edited,
      openVersion,
      closedSend,
    },
    refresh,
    focusStatus,
    readError: detail.error instanceof ApiError ? detail.error : null,
  };
}
