import {
  REPLY_POLL_INTERVAL_MS,
  REPLY_POLL_MAX_MS,
  replyOpenAnswerSchema,
  replyQueuedAnswerSchema,
  replyRecipientsAnswerSchema,
  replyRequestStatusSchema,
  z,
  type ReplyRecipientsBody,
  type ReplyRecipientsAnswer,
  type ReplyRequestStatus,
} from "@ea/core/web";

import { api } from "./api";

// The reply routes of the panel (`POST /api/replies`, `/api/approvals/:id/redraft`, `/recipients`, `GET /api/replies/requests/:id`).
// The instruction is the user's own line: it goes in the body of one request and is never kept or echoed by the page.

export type ReplyRequestAnswer = { kind: "queued"; requestId: string } | { kind: "open"; sendId: string };

// 202 `{ requestId }`: the drafter has the request. 200 `{ sendId }`: a draft of this mail is open already.
export async function postReplyRequest(emailId: string, instruction?: string): Promise<ReplyRequestAnswer> {
  const answer = await api("/api/replies", z.union([replyQueuedAnswerSchema, replyOpenAnswerSchema]), {
    method: "POST",
    body: instruction === undefined ? { emailId } : { emailId, instruction },
  });
  return "requestId" in answer
    ? { kind: "queued", requestId: answer.requestId }
    : { kind: "open", sendId: answer.sendId };
}

export async function postRedraft(sendId: string, instruction: string): Promise<{ requestId: string }> {
  return api(`/api/approvals/${encodeURIComponent(sendId)}/redraft`, replyQueuedAnswerSchema, {
    method: "POST",
    body: { instruction },
  });
}

export function postRecipients(sendId: string, mode: ReplyRecipientsBody["mode"]): Promise<ReplyRecipientsAnswer> {
  return api(`/api/approvals/${encodeURIComponent(sendId)}/recipients`, replyRecipientsAnswerSchema, {
    method: "POST",
    body: { mode },
  });
}

export function fetchReplyRequest(requestId: string): Promise<ReplyRequestStatus> {
  return api(`/api/replies/requests/${encodeURIComponent(requestId)}`, replyRequestStatusSchema);
}

// How a request that a user waits for ended. `done` and `superseded` name the draft to open (`superseded`: a newer mail of the thread has its own
// draft); the others carry the code that gives the text. `timeout`: it was not over after one minute; the draft may still arrive.
export type ReplyWaitOutcome =
  | { kind: "done"; sendId: string }
  | { kind: "superseded"; sendId: string | null }
  | { kind: "ended"; status: "no_draft" | "failed" | "cancelled"; reasonCode: string | null }
  | { kind: "timeout" };

export interface PollDeps {
  read(requestId: string): Promise<ReplyRequestStatus>;
  wait(ms: number): Promise<void>;
  now(): number;
}

const realDeps: PollDeps = {
  read: fetchReplyRequest,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

// Polls the request every 2 seconds for at most one minute. A read that fails is not the end of the request: the poll goes on
// until the time is up, then the page says the draft takes longer (a 404 or a network error repeats until then).
export async function waitForReply(
  requestId: string,
  options: { signal?: { aborted: boolean }; deps?: PollDeps } = {}
): Promise<ReplyWaitOutcome | "aborted"> {
  const deps = options.deps ?? realDeps;
  const started = deps.now();
  // A function, not a value: the flag changes while a read is on its way.
  const stopped = () => options.signal?.aborted === true;
  for (;;) {
    if (stopped()) return "aborted";
    let status: ReplyRequestStatus | null = null;
    try {
      status = await deps.read(requestId);
    } catch {
      status = null;
    }
    if (stopped()) return "aborted";
    if (status !== null) {
      if (status.status === "done") {
        if (status.sendId !== null) return { kind: "done", sendId: status.sendId };
        return { kind: "ended", status: "failed", reasonCode: "internal" };
      }
      if (status.status === "superseded") return { kind: "superseded", sendId: status.sendId };
      if (status.status === "no_draft" || status.status === "failed" || status.status === "cancelled") {
        return { kind: "ended", status: status.status, reasonCode: status.reasonCode };
      }
    }
    if (deps.now() - started + REPLY_POLL_INTERVAL_MS > REPLY_POLL_MAX_MS) return { kind: "timeout" };
    await deps.wait(REPLY_POLL_INTERVAL_MS);
  }
}
