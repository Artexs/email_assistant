import type { AgentMailSendRequest } from "@ea/core";
import { z } from "zod";

import { HardError, SoftError } from "../../../platform/errors";

export interface AgentMailInbox {
  inboxId: string;
  email: string;
  displayName: string | null;
  status: string | null;
  statusUntil: string | null;
}

export interface AgentMailSent {
  messageId: string;
  threadId: string;
}

export interface AgentMailMessageItem {
  messageId: string;
  threadId: string;
  labels: string[];
  timestamp: string;
}

/** The message is only the op, the status and two safe tokens: never the response `message`, never request data. */
export class AgentMailError extends Error {
  constructor(
    readonly op: string,
    readonly status: number,
    readonly errorName: string | null,
    readonly code: string | null,
    readonly retryAfterSec: number | null
  ) {
    super(`AgentMail ${op} failed: HTTP ${status} ${errorName ?? "-"} ${code ?? "-"}`);
    this.name = "AgentMailError";
  }
}

const idempotencyConflictName = "IdempotencyKeyConflictError";

/** 429, 5xx, or a 409 that is not a key conflict (a retry while the first request still runs). */
export function isSoftAgentMailError(error: unknown): boolean {
  if (!(error instanceof AgentMailError)) {
    return false;
  }
  return (
    error.status === 429 || error.status >= 500 || (error.status === 409 && error.errorName !== idempotencyConflictName)
  );
}

export function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof AgentMailError && error.status === 409 && error.errorName === idempotencyConflictName;
}

export interface AgentMailClient {
  /** POST /inboxes (idempotent by client_id). */
  ensureInbox(input: { username: string; clientId: string; displayName: string }): Promise<AgentMailInbox>;
  getInbox(inboxId: string): Promise<AgentMailInbox>;
  setDisplayName(inboxId: string, displayName: string): Promise<AgentMailInbox>;
  send(inboxId: string, request: AgentMailSendRequest, idempotencyKey: string): Promise<AgentMailSent>;
  /** First page (20 items) of the messages that really carry `label`. */
  listByLabel(inboxId: string, label: string): Promise<AgentMailMessageItem[]>;
}

const inboxSchema = z.object({
  inbox_id: z.string(),
  email: z.string(),
  display_name: z.string().nullish(),
  status: z.string().nullish(),
  status_until: z.string().nullish(),
});

const sentSchema = z.object({ message_id: z.string(), thread_id: z.string() });

const listSchema = z.object({
  messages: z.array(
    z.object({
      message_id: z.string(),
      thread_id: z.string(),
      labels: z.array(z.string()).nullish(),
      timestamp: z.string(),
    })
  ),
});

function toInbox(raw: z.infer<typeof inboxSchema>): AgentMailInbox {
  return {
    inboxId: raw.inbox_id,
    email: raw.email,
    displayName: raw.display_name ?? null,
    status: raw.status ?? null,
    statusUntil: raw.status_until ?? null,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,4}$/.test(value.trim())) {
    return null;
  }
  const seconds = Number(value.trim());
  return seconds <= 3600 ? seconds : null;
}

async function toAgentMailError(op: string, response: Response): Promise<AgentMailError> {
  let errorName: string | null = null;
  let code: string | null = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { name, code: rawCode } = body as { name?: unknown; code?: unknown };
      errorName = typeof name === "string" && /^[A-Za-z]{1,60}$/.test(name) ? name : null;
      code = typeof rawCode === "string" && /^[a-z_]{1,40}$/.test(rawCode) ? rawCode : null;
    }
  } catch {
    // No JSON body: the status is enough.
  }
  return new AgentMailError(op, response.status, errorName, code, parseRetryAfter(response.headers.get("Retry-After")));
}

export function createAgentMailClient(opts: {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): AgentMailClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    op: string,
    method: string,
    path: string,
    schema: z.ZodType<T>,
    options: { body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, ...options.headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (cause) {
      throw new SoftError(`AgentMail ${op}: network error`, { cause });
    }
    if (!response.ok) {
      throw await toAgentMailError(op, response);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      // A body that cannot be read (also invalid JSON) may hide a mail that went out: the caller repeats with the same key.
      throw new SoftError(`AgentMail ${op}: network error`, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new HardError(`AgentMail ${op}: unexpected response`);
    }
    return parsed.data;
  }

  const inboxPath = (inboxId: string): string => `/inboxes/${encodeURIComponent(inboxId)}`;

  return {
    async ensureInbox({ username, clientId, displayName }) {
      const raw = await call("ensureInbox", "POST", "/inboxes", inboxSchema, {
        body: { username, client_id: clientId, display_name: displayName },
      });
      return toInbox(raw);
    },
    async getInbox(inboxId) {
      return toInbox(await call("getInbox", "GET", inboxPath(inboxId), inboxSchema));
    },
    async setDisplayName(inboxId, displayName) {
      const raw = await call("setDisplayName", "PATCH", inboxPath(inboxId), inboxSchema, {
        body: { display_name: displayName },
      });
      return toInbox(raw);
    },
    async send(inboxId, request, idempotencyKey) {
      const raw = await call("send", "POST", `${inboxPath(inboxId)}/messages/send`, sentSchema, {
        body: request,
        headers: { "Idempotency-Key": idempotencyKey },
      });
      return { messageId: raw.message_id, threadId: raw.thread_id };
    },
    async listByLabel(inboxId, label) {
      const query = `labels=${encodeURIComponent(label)}&limit=20`;
      const raw = await call("listByLabel", "GET", `${inboxPath(inboxId)}/messages?${query}`, listSchema);
      return raw.messages
        .map((item) => ({
          messageId: item.message_id,
          threadId: item.thread_id,
          labels: item.labels ?? [],
          timestamp: item.timestamp,
        }))
        .filter((item) => item.labels.includes(label));
    },
  };
}
