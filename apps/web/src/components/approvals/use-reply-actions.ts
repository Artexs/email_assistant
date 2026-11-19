import type { ReplyRecipientsBody } from "@ea/core/web";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Notice } from "../../lib/approvals-notice";
import { postRecipients, postRedraft, waitForReply, type ReplyWaitOutcome } from "../../lib/replies-api";
import { replyFailure, resultTextKey } from "../../lib/replies-view";

export interface ReplyActionsDeps {
  // The send that the page shows now. A change of it ends the wait: the page does not open a version for a draft that it left.
  id: string | null;
  // Shows another send in place of this one (a new version, the newest version).
  open(id: string): void;
  say(notice: Notice): void;
  // The list and the badge of the page, and the item that is open.
  refresh(): void;
  reloadDetail(): void;
  focusStatus(): void;
}

// The redraft and the recipient choice of a reply on the approvals page. `waiting`: a redraft has no answer yet; the button stays off
// until it ends (several lines sent at once would all get one request id, and the service stores only the first line).
// `busy`: a call is on its way. Nothing here keeps the instruction after the call: the page holds it in the field only.
export function useReplyActions(deps: ReplyActionsDeps) {
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  // The wait that is running; the page that leaves, or moves to another send, aborts it.
  const signal = useRef<{ aborted: boolean }>({ aborted: false });
  // A flag in a ref stops a second click before React turns the button off.
  const running = useRef(false);
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  const stopWaiting = useCallback(() => {
    signal.current.aborted = true;
    signal.current = { aborted: false };
    setWaiting(false);
  }, []);

  useEffect(() => {
    stopWaiting();
    return stopWaiting;
  }, [deps.id, stopWaiting]);

  const fail = useCallback((error: unknown) => {
    const { say, open, refresh, reloadDetail, focusStatus } = latest.current;
    const outcome = replyFailure(error);
    switch (outcome.kind) {
      case "changed":
        say({ tone: "info", key: "appr_changed" });
        if (outcome.currentId === null) reloadDetail();
        else open(outcome.currentId);
        refresh();
        break;
      case "closed":
        say({ tone: "info", key: outcome.key });
        reloadDetail();
        refresh();
        break;
      case "message":
        say({ tone: "error", key: outcome.key });
        break;
      case "gone":
        say({ tone: "error", key: "appr_not_found" });
        reloadDetail();
        refresh();
        break;
      case "error":
        say({ tone: "error", key: outcome.key });
        break;
    }
    focusStatus();
  }, []);

  const finish = useCallback((outcome: ReplyWaitOutcome | "aborted") => {
    const { say, open, refresh, reloadDetail, focusStatus } = latest.current;
    if (outcome === "aborted") return;
    switch (outcome.kind) {
      case "done":
        say({ tone: "info", key: "rp_redraft_done" });
        open(outcome.sendId);
        break;
      case "superseded":
        say({ tone: "info", key: "rp_result_superseded" });
        if (outcome.sendId !== null) open(outcome.sendId);
        else reloadDetail();
        break;
      case "ended":
        say({ tone: "error", key: resultTextKey(outcome.reasonCode) });
        reloadDetail();
        break;
      case "timeout":
        say({ tone: "error", key: "rp_poll_timeout" });
        break;
    }
    refresh();
    focusStatus();
  }, []);

  // One line makes a new version (the model writes it). The page waits for the answer of the request.
  const redraft = useCallback(
    async (sendId: string, line: string) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      const mine = signal.current;
      try {
        const { requestId } = await postRedraft(sendId, line);
        setWaiting(true);
        const outcome = await waitForReply(requestId, { signal: mine });
        if (!mine.aborted) finish(outcome);
      } catch (error) {
        if (!mine.aborted) fail(error);
      } finally {
        running.current = false;
        setBusy(false);
        if (!mine.aborted) setWaiting(false);
      }
    },
    [fail, finish]
  );

  // Other recipients make a new version at once (no model): the page opens it.
  const recipients = useCallback(
    async (sendId: string, mode: ReplyRecipientsBody["mode"]) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        const answer = await postRecipients(sendId, mode);
        const { say, open, refresh, focusStatus } = latest.current;
        say({ tone: "info", key: "appr_edit_saved", n: answer.version });
        open(answer.id);
        refresh();
        focusStatus();
      } catch (error) {
        fail(error);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [fail]
  );

  return { waiting, busy, redraft, recipients };
}
