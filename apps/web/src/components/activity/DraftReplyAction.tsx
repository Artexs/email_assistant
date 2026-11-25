import type { ActivityItem } from "@ea/core/web";
import { PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { t, type TextKey } from "../../i18n";
import { subjectText } from "../../lib/activity-text";
import { canWrite } from "../../lib/can-write";
import { approvalLink } from "../../lib/delegations-view";
import { postReplyRequest, waitForReply } from "../../lib/replies-api";
import { replyFailure, resultTextKey } from "../../lib/replies-view";
import { useMe } from "../shell/MeProvider";
import { Button } from "../ui/button";

type State =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "open"; sendId: string }
  | { kind: "message"; key: TextKey };

export interface DraftReplyActionProps {
  item: Pick<ActivityItem, "emailId" | "subject" | "reply">;
}

// "Draft reply" on a mail row (the key `reply` is there only while the flag `reply_drafts` is on; an owner who may write sees the button).
// A tap asks for a draft and waits for it (at most a minute); the row then links to the draft on the approvals page. A mail that has an
// open draft shows "Open the draft" at once. A refusal says why in one line. The server checks every rule again: the button is a hint.
export function DraftReplyAction({ item }: DraftReplyActionProps) {
  const { me } = useMe();
  const [state, setState] = useState<State>({ kind: "idle" });
  // A row that leaves the page stops its wait.
  const signal = useRef({ aborted: false });
  useEffect(
    () => () => {
      signal.current.aborted = true;
    },
    []
  );
  if (item.reply === undefined || me?.role !== "owner" || !canWrite(me)) return null;

  const subject = subjectText(item.subject);
  const openId = state.kind === "open" ? state.sendId : item.reply.sendId;
  if (openId !== null) {
    return (
      <Button asChild size="sm" variant="outline">
        <a href={approvalLink(openId)} aria-label={t("rp_open_draft_for", { subject })}>
          {t("rp_open_draft")}
        </a>
      </Button>
    );
  }

  const ask = async () => {
    setState({ kind: "waiting" });
    try {
      const answer = await postReplyRequest(item.emailId);
      if (answer.kind === "open") return setState({ kind: "open", sendId: answer.sendId });
      const outcome = await waitForReply(answer.requestId, { signal: signal.current });
      if (outcome === "aborted") return;
      switch (outcome.kind) {
        case "done":
          return setState({ kind: "open", sendId: outcome.sendId });
        case "superseded":
          return outcome.sendId === null
            ? setState({ kind: "message", key: "rp_result_superseded" })
            : setState({ kind: "open", sendId: outcome.sendId });
        case "ended":
          return setState({ kind: "message", key: resultTextKey(outcome.reasonCode) });
        case "timeout":
          return setState({ kind: "message", key: "rp_poll_timeout" });
      }
    } catch (error) {
      if (signal.current.aborted) return;
      const failure = replyFailure(error);
      if (failure.kind === "changed") return setState({ kind: "message", key: "appr_changed" });
      if (failure.kind === "gone") return setState({ kind: "message", key: "err_not_found" });
      setState({ kind: "message", key: failure.key });
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={state.kind === "waiting"}
        aria-label={t("rp_draft_reply_for", { subject })}
        onClick={() => void ask()}
      >
        <PenLine aria-hidden="true" />
        {t("rp_draft_reply")}
      </Button>
      <span role="status" className="text-sm">
        {state.kind === "waiting" ? t("rp_drafting") : ""}
      </span>
      {state.kind === "message" && (
        <p role="alert" className="w-full text-sm text-destructive">
          {t(state.key)}
        </p>
      )}
    </>
  );
}
