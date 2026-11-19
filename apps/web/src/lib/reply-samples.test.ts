import { describe, expect, test } from "bun:test";

import { REPLY_POLL_INTERVAL_MS, REPLY_POLL_MAX_MS } from "@ea/core/web";

import {
  sampleFailureKey,
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

  test("a run that ended at the first read needs no wait", async () => {
    const run = deps([[item("done")]]);
    expect((await waitForSamples("m1", { deps: run.deps })).kind).toBe("done");
    expect(run.waits).toEqual([]);
  });
});
