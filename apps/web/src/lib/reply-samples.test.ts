import { afterEach, describe, expect, test } from "bun:test";

import { REPLY_POLL_INTERVAL_MS, REPLY_POLL_MAX_MS } from "@ea/core/web";

import {
  askSamples,
  loadSamples,
  messageTone,
  sampleFailureKey,
  samplesButtonOff,
  type SamplesState,
  samplesInProgress,
  waitForSamples,
  type SampleItem,
  type SamplePollDeps,
} from "./reply-samples";

const item = (status: SampleItem["status"], over: Partial<SampleItem> = {}): SampleItem => ({
  requestId: "0190f5a0-0000-7000-8000-000000000001",
  status,
  reasonCode: null,
  subject: "Temat",
  body: status === "done" ? "Tekst" : null,
  ...over,
});

// A clock that only the waits move.
function deps(reads: (SampleItem[] | Error)[]): { deps: SamplePollDeps; waits: number[]; reads: () => number } {
  let now = 0;
  let index = 0;
  const waits: number[] = [];
  return {
    waits,
    reads: () => index,
    deps: {
      read: async () => {
        const next = reads[Math.min(index, reads.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next ?? [];
      },
      wait: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      now: () => now,
    },
  };
}

describe("samplesInProgress", () => {
  test("a pending or drafting request is in progress; an ended one is not", () => {
    expect(samplesInProgress([item("pending")])).toBe(true);
    expect(samplesInProgress([item("done"), item("drafting")])).toBe(true);
    expect(samplesInProgress([item("done"), item("no_draft"), item("failed"), item("cancelled")])).toBe(false);
    expect(samplesInProgress([])).toBe(false);
  });
});

describe("sampleFailureKey", () => {
  test("no_draft and the daily cap have their own texts; any other end reads as failed", () => {
    expect(sampleFailureKey(item("no_draft", { reasonCode: "needs_facts" }))).toBe("rs_samples_no_draft");
    expect(sampleFailureKey(item("failed", { reasonCode: "llm_cap" }))).toBe("rs_preview_cap");
    expect(sampleFailureKey(item("failed", { reasonCode: "timeout" }))).toBe("rs_samples_failed");
    expect(sampleFailureKey(item("cancelled", { reasonCode: "feature_off" }))).toBe("rs_samples_failed");
  });
});

describe("waitForSamples", () => {
  test("it reads every two seconds until no request waits", async () => {
    const run = deps([[item("pending")], [item("drafting"), item("pending")], [item("done"), item("done")]]);
    const outcome = await waitForSamples("m1", { deps: run.deps });
    expect(outcome).toEqual({ kind: "done", items: [item("done"), item("done")] });
    expect(run.waits).toEqual([REPLY_POLL_INTERVAL_MS, REPLY_POLL_INTERVAL_MS]);
  });

  test("a read that fails does not end the wait; it stops at one minute with a timeout", async () => {
    const run = deps([new Error("network"), [item("pending")]]);
    const outcome = await waitForSamples("m1", { deps: run.deps });
    expect(outcome).toEqual({ kind: "timeout" });
    expect(run.waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(REPLY_POLL_MAX_MS);
    expect(run.reads()).toBeGreaterThan(20);
  });

  test("an aborted card stops the wait before and after a read", async () => {
    const signal = { aborted: true };
    const before = deps([[item("pending")]]);
    expect(await waitForSamples("m1", { signal, deps: before.deps })).toEqual({ kind: "aborted" });
    expect(before.reads()).toBe(0);

    const live = { aborted: false };
    const run = deps([[item("pending")]]);
    const original = run.deps.read;
    run.deps.read = async (id) => {
      live.aborted = true;
      return original(id);
    };
    expect(await waitForSamples("m1", { signal: live, deps: run.deps })).toEqual({ kind: "aborted" });
  });

  test("an aborted card stops the wait after a read that shows a finished run too", async () => {
    const live = { aborted: false };
    const run = deps([[item("done")]]);
    const original = run.deps.read;
    run.deps.read = async (id) => {
      const items = await original(id);
      live.aborted = true;
      return items;
    };
    expect(await waitForSamples("m1", { signal: live, deps: run.deps })).toEqual({ kind: "aborted" });
  });

  test("a run that ended at the first read needs no wait", async () => {
    const run = deps([[item("done")]]);
    expect((await waitForSamples("m1", { deps: run.deps })).kind).toBe("done");
    expect(run.waits).toEqual([]);
  });
});

describe("the calls", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const MAILBOX = "0190f5a0-0000-7000-8000-0000000000d1";
  const IDS = ["0190f5a0-0000-7000-8000-0000000000e1", "0190f5a0-0000-7000-8000-0000000000e2"];

  function answer(status: number, body: unknown): { calls: { url: string; method: string | undefined }[] } {
    const calls: { url: string; method: string | undefined }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { calls };
  }

  test("a run is asked with a POST on the route of the mailbox; 202 gives the count", async () => {
    const seen = answer(202, { requestIds: IDS, count: 2 });
    expect(await askSamples(MAILBOX)).toEqual({ kind: "queued", count: 2 });
    expect(seen.calls).toEqual([{ url: `/api/mailboxes/${MAILBOX}/reply-samples`, method: "POST" }]);
    answer(202, { requestIds: [], count: 0 });
    expect(await askSamples(MAILBOX)).toEqual({ kind: "queued", count: 0 });
  });

  test("a 409 is an answer with its own text: the day limit, no model, an OAuth mailbox; another error is thrown", async () => {
    answer(409, { error: "sample_limit" });
    expect(await askSamples(MAILBOX)).toEqual({ kind: "refused", key: "rs_samples_limit" });
    answer(409, { error: "llm_off" });
    expect(await askSamples(MAILBOX)).toEqual({ kind: "refused", key: "rs_samples_llm_off" });
    answer(409, { error: "blocked", reason: "oauth_mailbox" });
    expect(await askSamples(MAILBOX)).toEqual({ kind: "refused", key: "rs_samples_oauth" });
    answer(409, { error: "something_else" });
    await expect(askSamples(MAILBOX)).rejects.toThrow();
    answer(500, { error: "internal" });
    await expect(askSamples(MAILBOX)).rejects.toThrow();
  });

  test("the run of today is read with a GET and the items are kept as the server sent them", async () => {
    const item = { requestId: IDS[0], status: "done", reasonCode: null, subject: null, body: "Tekst" };
    const seen = answer(200, { items: [item] });
    expect(await loadSamples(MAILBOX)).toEqual([item as SampleItem]);
    expect(seen.calls).toEqual([{ url: `/api/mailboxes/${MAILBOX}/reply-samples`, method: "GET" }]);
  });
});

describe("the card states", () => {
  const states: [SamplesState, boolean][] = [
    [{ kind: "loading" }, true],
    [{ kind: "idle" }, false],
    [{ kind: "running" }, true],
    // A slow run may still finish: a click would only get the day limit.
    [{ kind: "slow" }, true],
    [{ kind: "shown", items: [] }, true],
    // A refused run or a run with no mail leaves the button on.
    [{ kind: "message", key: "rs_samples_none" }, false],
    [{ kind: "message", key: "rs_samples_llm_off" }, false],
  ];

  test("the button is off while the state is read, a run is written or shown, and a slow run may finish", () => {
    for (const [state, off] of states)
      expect({ kind: state.kind, off: samplesButtonOff(state) }).toEqual({ kind: state.kind, off });
  });

  test("no mail and the day limit are notes; a failure is an error", () => {
    expect(messageTone("rs_samples_none")).toBe("note");
    expect(messageTone("rs_samples_limit")).toBe("note");
    for (const key of ["rs_samples_llm_off", "rs_samples_oauth", "rs_samples_failed", "error_generic"] as const) {
      expect(messageTone(key), key).toBe("error");
    }
  });
});
