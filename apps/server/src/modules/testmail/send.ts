import { createHash } from "node:crypto";

import {
  buildSendRequest,
  caseLabel,
  caseStates,
  idempotencyKey,
  planSends,
  type AgentMailSendRequest,
  type Batch,
  type CaseState,
  type PersonaFile,
  type SendAction,
  type SendLogLine,
  type SkipReason,
} from "@ea/core";

import { SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import {
  AgentMailError,
  isIdempotencyConflict,
  isSoftAgentMailError,
  type AgentMailClient,
  type AgentMailSent,
} from "./agentmail/client";

const log = createLog("testmail");

const MAX_REPEATS = 3;

export function requestHash(inboxId: string, request: AgentMailSendRequest): string {
  return createHash("sha256").update(JSON.stringify({ inboxId, request })).digest("hex");
}

export interface SendDeps {
  client: AgentMailClient;
  now(): Date;
  sleep(ms: number): Promise<void>;
  append(line: SendLogLine): void;
}

export interface SendRunInput {
  batch: Batch;
  personas: PersonaFile;
  inboxId: string;
  to: string;
  lines: SendLogLine[]; // this batch's log
  sentInLast24h: number; // from all logs
  dailyCap: number;
  limit: number | null;
  intervalMs: number;
  currentDisplayName: string | null;
}

export type StoppedBy =
  | "cap"
  | "limit"
  | "rate_limit"
  | "network"
  | "rejected"
  | "auth"
  | "inbox_missing"
  | "duplicate_found";

export interface SendRunResult {
  sent: string[];
  recovered: string[];
  failed: { caseId: string; code: string }[];
  /** "open" = not done yet and no plan skip reason (an open intent, or a case that a stop left unsent). */
  remaining: { caseId: string; reason: SkipReason | "open" }[];
  stoppedBy: null | StoppedBy;
  exitCode: 0 | 1 | 2;
}

/** Thrown inside the loop to end the run with a reason. */
class StopRun extends Error {
  constructor(readonly reason: StoppedBy) {
    super(`stop: ${reason}`);
    this.name = "StopRun";
  }
}

const hardStops: readonly StoppedBy[] = ["rejected", "auth", "inbox_missing", "duplicate_found"];

export async function runSend(deps: SendDeps, input: SendRunInput): Promise<SendRunResult> {
  const { client, now, sleep } = deps;
  const { batch, personas, inboxId, to } = input;
  const lines = [...input.lines];
  const caseIds = batch.cases.map((testCase) => testCase.id);
  const sent: string[] = [];
  const recovered: string[] = [];
  let sentInLast24h = input.sentInLast24h;
  let currentDisplayName = input.currentDisplayName;
  let actionsDone = 0;
  let consecutive403 = 0;
  let needPace = false;
  let stoppedBy: StoppedBy | null = null;

  const append = (line: SendLogLine): void => {
    deps.append(line);
    lines.push(line);
  };

  const buildRequest = (caseId: string, states: Map<string, CaseState>): AgentMailSendRequest | null => {
    const testCase = batch.cases.find((item) => item.id === caseId);
    if (testCase === undefined) {
      return null;
    }
    let parentMessageId: string | null = null;
    if (testCase.replyTo !== undefined) {
      const parent = states.get(testCase.replyTo);
      if (parent?.kind !== "sent") {
        return null;
      }
      parentMessageId = parent.messageId;
    }
    return buildSendRequest({ batchId: batch.batch, testCase, to, parentMessageId });
  };

  const computeHashes = (states: Map<string, CaseState>): Map<string, string> => {
    const hashes = new Map<string, string>();
    for (const id of caseIds) {
      const request = buildRequest(id, states);
      if (request !== null) {
        hashes.set(id, requestHash(inboxId, request));
      }
    }
    return hashes;
  };

  const plan = (limit: number | null): ReturnType<typeof planSends> => {
    const states = caseStates(batch.batch, caseIds, lines);
    return planSends({
      batch,
      states,
      hashes: computeHashes(states),
      now: now(),
      sentInLast24h,
      dailyCap: input.dailyCap,
      limit: limit === null ? null : Math.max(0, limit - actionsDone),
    });
  };

  /** Repeat the identical call after a soft error, at most 3 times. */
  async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    for (let n = 0; ; n += 1) {
      try {
        return await call();
      } catch (error) {
        if (!isSoftAgentMailError(error) && !(error instanceof SoftError)) {
          throw error;
        }
        const rateLimited = error instanceof AgentMailError && error.status === 429;
        if (n >= MAX_REPEATS) {
          throw new StopRun(rateLimited ? "rate_limit" : "network");
        }
        const seconds = rateLimited ? Math.min(60, (error as AgentMailError).retryAfterSec ?? 1) * 2 ** n : 5 * 2 ** n;
        log.info(`waiting ${seconds * 1000} ms (${error instanceof AgentMailError ? error.status : "network"})`);
        await sleep(seconds * 1000);
      }
    }
  }

  const stopForHardError = (error: unknown): never => {
    if (error instanceof AgentMailError) {
      if (error.status === 401) {
        throw new StopRun("auth");
      }
      throw new StopRun(error.status === 404 ? "inbox_missing" : "rejected");
    }
    throw error;
  };

  async function applyDisplayName(caseId: string): Promise<void> {
    const testCase = batch.cases.find((item) => item.id === caseId);
    const displayName = personas.personas.find((persona) => persona.key === testCase?.persona)?.displayName;
    if (displayName === undefined || displayName === currentDisplayName) {
      return;
    }
    try {
      await withRetry(() => client.setDisplayName(inboxId, displayName));
    } catch (error) {
      if (error instanceof StopRun) {
        throw error;
      }
      return stopForHardError(error);
    }
    currentDisplayName = displayName;
  }

  function markFailed(caseId: string, attempt: number, key: string, code: string): void {
    append({ type: "failed", batch: batch.batch, case: caseId, attempt, key, code, at: now().toISOString() });
    log.info(`failed ${batch.batch}/${caseId} ${code}`);
  }

  async function sendCase(caseId: string, attempt: number, key: string): Promise<void> {
    const request = buildRequest(caseId, caseStates(batch.batch, caseIds, lines));
    if (request === null) {
      throw new Error(`No request for case ${caseId}`);
    }
    await applyDisplayName(caseId);
    let result: AgentMailSent;
    try {
      result = await withRetry(() => client.send(inboxId, request, key));
    } catch (error) {
      if (!(error instanceof AgentMailError)) {
        throw error;
      }
      if (isIdempotencyConflict(error)) {
        consecutive403 = 0;
        markFailed(caseId, attempt, key, "idempotency_conflict");
        return;
      }
      if (error.status === 401) {
        throw new StopRun("auth");
      }
      if (error.status === 404) {
        throw new StopRun("inbox_missing");
      }
      consecutive403 = error.status === 403 ? consecutive403 + 1 : 0;
      markFailed(caseId, attempt, key, `http_${error.status}`);
      if (consecutive403 >= 2) {
        throw new StopRun("rejected");
      }
      return;
    }
    consecutive403 = 0;
    append({
      type: "sent",
      batch: batch.batch,
      case: caseId,
      attempt,
      key,
      messageId: result.messageId,
      threadId: result.threadId,
      inbox: inboxId,
      via: "send",
      at: now().toISOString(),
    });
    log.info(`sent ${batch.batch}/${caseId} attempt ${attempt}`);
    sent.push(caseId);
    sentInLast24h += 1;
    needPace = true;
  }

  function appendIntent(caseId: string, attempt: number, key: string): void {
    const states = caseStates(batch.batch, caseIds, lines);
    const hash = computeHashes(states).get(caseId);
    if (hash === undefined) {
      throw new Error(`No hash for case ${caseId}`);
    }
    append({ type: "intent", batch: batch.batch, case: caseId, attempt, key, hash, at: now().toISOString() });
  }

  async function execute(action: SendAction): Promise<void> {
    if (action.kind === "send") {
      if (!action.reuse) {
        appendIntent(action.caseId, action.attempt, action.key);
      }
      await sendCase(action.caseId, action.attempt, action.key);
      return;
    }
    const label = caseLabel(batch.batch, action.caseId);
    let found;
    try {
      found = await withRetry(() => client.listByLabel(inboxId, label));
    } catch (error) {
      if (error instanceof StopRun) {
        throw error;
      }
      return stopForHardError(error);
    }
    const [match, ...others] = found;
    if (match !== undefined && others.length > 0) {
      throw new StopRun("duplicate_found");
    }
    if (match !== undefined) {
      append({
        type: "sent",
        batch: batch.batch,
        case: action.caseId,
        attempt: action.attempt,
        key: action.key,
        messageId: match.messageId,
        threadId: match.threadId,
        inbox: inboxId,
        via: "label",
        at: now().toISOString(),
      });
      log.info(`recovered ${batch.batch}/${action.caseId} by label`);
      recovered.push(action.caseId);
      return;
    }
    const attempt = action.attempt + 1;
    const key = idempotencyKey(batch.batch, action.caseId, attempt);
    appendIntent(action.caseId, attempt, key);
    await sendCase(action.caseId, attempt, key);
  }

  try {
    for (;;) {
      const current = plan(input.limit);
      const [action] = current.actions;
      if (action === undefined) {
        const stopSkip = current.skipped.find((item) => item.reason === "cap" || item.reason === "limit");
        stoppedBy = stopSkip === undefined ? null : (stopSkip.reason as "cap" | "limit");
        break;
      }
      if (needPace) {
        needPace = false;
        await sleep(input.intervalMs);
        continue;
      }
      actionsDone += 1;
      await execute(action);
    }
  } catch (error) {
    if (!(error instanceof StopRun)) {
      throw error;
    }
    stoppedBy = error.reason;
  }
  if (stoppedBy !== null) {
    log.info(`stopped: ${stoppedBy}`);
  }

  const states = caseStates(batch.batch, caseIds, lines);
  const skipped = plan(input.limit).skipped;
  const failed: SendRunResult["failed"] = [];
  const remaining: SendRunResult["remaining"] = [];
  for (const id of caseIds) {
    const state = states.get(id);
    if (state?.kind === "sent") {
      continue;
    }
    if (state?.kind === "failed") {
      failed.push({ caseId: id, code: state.code });
      continue;
    }
    const reason = skipped.find((item) => item.caseId === id)?.reason;
    remaining.push({ caseId: id, reason: reason ?? "open" });
  }
  const needsFix =
    failed.length > 0 ||
    remaining.some((item) => item.reason === "changed" || item.reason === "blocked") ||
    (stoppedBy !== null && hardStops.includes(stoppedBy));
  const allDone = failed.length === 0 && remaining.length === 0;
  const exitCode = needsFix ? 1 : allDone ? 0 : 2;
  return { sent, recovered, failed, remaining, stoppedBy, exitCode };
}
