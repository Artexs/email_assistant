import {
  REPLY_POLL_INTERVAL_MS,
  REPLY_POLL_MAX_MS,
  replySamplesQueuedSchema,
  replySamplesViewSchema,
  type ReplySamplesView,
} from "@ea/core/web";

import type { TextKey } from "../i18n";

import { api, ApiError } from "./api";

// The sample drafts of the style card: `POST` and `GET /api/mailboxes/:id/reply-samples`. A sample is read on the page; it is never
// saved in Drafts and never sent.

export type SampleItem = ReplySamplesView["items"][number];

export function samplesPath(mailboxId: string): string {
  return `/api/mailboxes/${encodeURIComponent(mailboxId)}/reply-samples`;
}

export function loadSamples(mailboxId: string): Promise<SampleItem[]> {
  return api(samplesPath(mailboxId), replySamplesViewSchema).then((view) => view.items);
}

export type SamplesAsked = { kind: "queued"; count: number } | { kind: "refused"; key: TextKey };

const conflictKeys: Record<string, TextKey> = {
  sample_limit: "rs_samples_limit",
  llm_off: "rs_samples_llm_off",
};

// 202 `{ requestIds, count }`. A 409 is an answer, not a failure of the call: `sample_limit` (once a day), `llm_off`, and `blocked`
// (an OAuth mailbox). Any other error is thrown.
export async function askSamples(mailboxId: string): Promise<SamplesAsked> {
  try {
    const answer = await api(samplesPath(mailboxId), replySamplesQueuedSchema, { method: "POST", body: {} });
    return { kind: "queued", count: answer.count };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      if (error.code === "blocked") return { kind: "refused", key: "rs_samples_oauth" };
      const key = Object.hasOwn(conflictKeys, error.code) ? conflictKeys[error.code] : undefined;
      if (key !== undefined) return { kind: "refused", key };
    }
    throw error;
  }
}

// A request that still waits for the drafter.
export const sampleInProgress = (item: SampleItem): boolean => item.status === "pending" || item.status === "drafting";

export const samplesInProgress = (items: readonly SampleItem[]): boolean => items.some(sampleInProgress);

// The text of a sample that has no body. `no_draft`: the model found that the mail needs facts or no reply; `llm_cap`: the daily limit.
export function sampleFailureKey(item: SampleItem): TextKey {
  if (item.status === "no_draft") return "rs_samples_no_draft";
  if (item.reasonCode === "llm_cap") return "rs_preview_cap";
  return "rs_samples_failed";
}

export interface SamplePollDeps {
  read(mailboxId: string): Promise<SampleItem[]>;
  wait(ms: number): Promise<void>;
  now(): number;
}

const realDeps: SamplePollDeps = {
  read: loadSamples,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

// Reads the run every 2 seconds for at most one minute, until no request waits. A read that fails does not end the wait. `timeout`: the
// run was not over after one minute (the page then says so; a reload shows the rest). `aborted`: the card went away.
export async function waitForSamples(
  mailboxId: string,
  options: { signal?: { aborted: boolean }; deps?: SamplePollDeps } = {}
): Promise<{ kind: "done"; items: SampleItem[] } | { kind: "timeout" } | { kind: "aborted" }> {
  const deps = options.deps ?? realDeps;
  const started = deps.now();
  const stopped = () => options.signal?.aborted === true;
  for (;;) {
    if (stopped()) return { kind: "aborted" };
    let items: SampleItem[] | null = null;
    try {
      items = await deps.read(mailboxId);
    } catch {
      items = null;
    }
    if (stopped()) return { kind: "aborted" };
    if (items !== null && !samplesInProgress(items)) return { kind: "done", items };
    if (deps.now() - started + REPLY_POLL_INTERVAL_MS > REPLY_POLL_MAX_MS) return { kind: "timeout" };
    await deps.wait(REPLY_POLL_INTERVAL_MS);
  }
}
