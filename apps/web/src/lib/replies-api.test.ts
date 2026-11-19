import { afterEach, describe, expect, test } from "bun:test";
import { REPLY_POLL_INTERVAL_MS, REPLY_POLL_MAX_MS, type ReplyRequestStatus } from "@ea/core/web";

import { postRecipients, postRedraft, postReplyRequest, waitForReply, type PollDeps } from "./replies-api";

const REQUEST = "0190f5a0-0000-7000-8000-0000000000b1";
const SEND = "0190f5a0-0000-7000-8000-0000000000a1";
const MAIL = "0190f5a0-0000-7000-8000-0000000000c1";

const status = (patch: Partial<ReplyRequestStatus>): ReplyRequestStatus => ({
  status: "pending",
  reasonCode: null,
  sendId: null,
  ...patch,
});

// A clock that only the fake wait moves, and a script of answers: one entry for each read (an Error is a failed read).
function world(script: (ReplyRequestStatus | Error)[]) {
  let clock = 0;
  const reads: number[] = [];
  const deps: PollDeps = {
    read: async () => {
      reads.push(clock);
      const next = script[Math.min(reads.length - 1, script.length - 1)];
      if (next instanceof Error) throw next;
      return next as ReplyRequestStatus;
    },
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, reads };
}

describe("waitForReply: the poll of the page", () => {
  test("it reads at once, then every 2 seconds, and ends on `done` with the id of the new version", async () => {
    const w = world([status({}), status({ status: "drafting" }), status({ status: "done", sendId: SEND })]);
    expect(await waitForReply(REQUEST, { deps: w.deps })).toEqual({ kind: "done", sendId: SEND });
    expect(w.reads).toEqual([0, REPLY_POLL_INTERVAL_MS, 2 * REPLY_POLL_INTERVAL_MS]);
  });

  test("a request that never ends stops after one minute with `timeout`: 31 reads, the last one at 60 s, none after", async () => {
    const w = world([status({})]);
    expect(await waitForReply(REQUEST, { deps: w.deps })).toEqual({ kind: "timeout" });
    expect(w.reads.length).toBe(REPLY_POLL_MAX_MS / REPLY_POLL_INTERVAL_MS + 1);
    expect(Math.max(...w.reads)).toBe(REPLY_POLL_MAX_MS);
  });

  test("each end of a request: `superseded` names the open draft or none; no_draft, failed and cancelled carry their code", async () => {
    expect(await waitForReply(REQUEST, { deps: world([status({ status: "superseded", sendId: SEND })]).deps })).toEqual(
      {
        kind: "superseded",
        sendId: SEND,
      }
    );
    expect(await waitForReply(REQUEST, { deps: world([status({ status: "superseded" })]).deps })).toEqual({
      kind: "superseded",
      sendId: null,
    });
    for (const end of ["no_draft", "failed", "cancelled"] as const) {
      expect(
        await waitForReply(REQUEST, { deps: world([status({ status: end, reasonCode: "needs_facts" })]).deps })
      ).toEqual({
        kind: "ended",
        status: end,
        reasonCode: "needs_facts",
      });
    }
    // A `done` request with no draft cannot be opened: the page says that something went wrong.
    expect(await waitForReply(REQUEST, { deps: world([status({ status: "done" })]).deps })).toEqual({
      kind: "ended",
      status: "failed",
      reasonCode: "internal",
    });
  });

  test("a failed read does not end the poll; the next read counts", async () => {
    const w = world([new Error("network"), status({ status: "done", sendId: SEND })]);
    expect(await waitForReply(REQUEST, { deps: w.deps })).toEqual({ kind: "done", sendId: SEND });
    expect(w.reads.length).toBe(2);
  });

  test("the page that leaves stops the poll: no read after the signal", async () => {
    const signal = { aborted: false };
    const w = world([status({})]);
    const deps: PollDeps = {
      ...w.deps,
      wait: async (ms) => {
        await w.deps.wait(ms);
        signal.aborted = true;
      },
    };
    expect(await waitForReply(REQUEST, { deps, signal })).toBe("aborted");
    expect(w.reads.length).toBe(1);
  });
});

describe("waitForReply: a page that leaves during a read", () => {
  test("the answer of that read is dropped: no draft is opened for a page that is gone", async () => {
    const signal = { aborted: false };
    const deps: PollDeps = {
      read: async () => {
        signal.aborted = true;
        return status({ status: "done", sendId: SEND });
      },
      wait: async () => undefined,
      now: () => 0,
    };
    expect(await waitForReply(REQUEST, { deps, signal })).toBe("aborted");
  });
});

describe("the calls", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function answer(status: number, body: unknown): { calls: { url: string; body: unknown }[] } {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { calls };
  }

  test("a request for a draft: 202 is queued, 200 is an open draft; the line is sent only when there is one", async () => {
    let seen = answer(202, { requestId: REQUEST });
    expect(await postReplyRequest(MAIL)).toEqual({ kind: "queued", requestId: REQUEST });
    expect(seen.calls).toEqual([{ url: "/api/replies", body: { emailId: MAIL } }]);

    seen = answer(200, { sendId: SEND });
    expect(await postReplyRequest(MAIL, "krócej")).toEqual({ kind: "open", sendId: SEND });
    expect(seen.calls[0]?.body).toEqual({ emailId: MAIL, instruction: "krócej" });
  });

  test("a redraft and a recipients change go to the route of the send, with the line or the mode only", async () => {
    let seen = answer(202, { requestId: REQUEST });
    expect(await postRedraft(SEND, "tak na wtorek")).toEqual({ requestId: REQUEST });
    expect(seen.calls).toEqual([{ url: `/api/approvals/${SEND}/redraft`, body: { instruction: "tak na wtorek" } }]);

    seen = answer(200, { id: SEND, version: 2 });
    expect(await postRecipients(SEND, "all")).toEqual({ id: SEND, version: 2 });
    expect(seen.calls).toEqual([{ url: `/api/approvals/${SEND}/recipients`, body: { mode: "all" } }]);
  });
});
