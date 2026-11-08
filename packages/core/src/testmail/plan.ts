import type { Batch } from "./batch";
import { idempotencyKey, type CaseState } from "./send-log";

export const KEY_REUSE_MS = 12 * 3_600_000; // margin for a wrong PC clock against the 24 h server-side key expiry

export type SendAction =
  | { kind: "send"; caseId: string; attempt: number; key: string; reuse: boolean }
  | { kind: "recover"; caseId: string; attempt: number; key: string };
export type SkipReason = "sent" | "failed" | "changed" | "waiting_parent" | "blocked" | "cap" | "limit";
export interface SendPlan {
  actions: SendAction[];
  skipped: { caseId: string; reason: SkipReason }[];
}

export function planSends(input: {
  batch: Batch;
  states: Map<string, CaseState>;
  hashes: Map<string, string>;
  now: Date;
  sentInLast24h: number;
  dailyCap: number;
  limit: number | null;
}): SendPlan {
  const { batch, states, hashes, now, sentInLast24h, dailyCap, limit } = input;
  const actions: SendAction[] = [];
  const skipped: SendPlan["skipped"] = [];
  const skipReasons = new Map<string, SkipReason>();

  const skip = (caseId: string, reason: SkipReason): void => {
    skipped.push({ caseId, reason });
    skipReasons.set(caseId, reason);
  };
  const admit = (caseId: string, action: SendAction): void => {
    if (sentInLast24h + actions.length >= dailyCap) skip(caseId, "cap");
    else if (limit !== null && actions.length >= limit) skip(caseId, "limit");
    else actions.push(action);
  };

  for (const testCase of batch.cases) {
    const id = testCase.id;
    const state = states.get(id) ?? { kind: "due" };
    if (state.kind === "sent") {
      skip(id, "sent");
    } else if (state.kind === "failed") {
      skip(id, "failed");
    } else if (state.kind === "open") {
      if (hashes.get(id) !== state.hash) skip(id, "changed");
      else if (now.getTime() - state.at.getTime() < KEY_REUSE_MS) {
        admit(id, { kind: "send", caseId: id, attempt: state.attempt, key: state.key, reuse: true });
      } else admit(id, { kind: "recover", caseId: id, attempt: state.attempt, key: state.key });
    } else {
      const parent = testCase.replyTo;
      if (parent !== undefined && states.get(parent)?.kind !== "sent") {
        const parentState = states.get(parent)?.kind ?? "due";
        const parentSkip = skipReasons.get(parent);
        const blocked = parentState === "failed" || parentSkip === "changed" || parentSkip === "blocked";
        skip(id, blocked ? "blocked" : "waiting_parent");
      } else {
        admit(id, { kind: "send", caseId: id, attempt: 1, key: idempotencyKey(batch.batch, id, 1), reuse: false });
      }
    }
  }
  return { actions, skipped };
}
