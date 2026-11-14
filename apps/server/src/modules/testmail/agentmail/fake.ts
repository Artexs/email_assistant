import type { AgentMailSendRequest } from "@ea/core";

type FakeOp = "send" | "patch" | "list" | "create" | "get";

interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface FakeInbox {
  inboxId: string;
  clientId: string;
  displayName: string;
}

interface StoredMessage {
  inboxId: string;
  messageId: string;
  threadId: string;
  labels: string[];
  timestamp: string;
}

export interface FakeAgentMail {
  /** http://127.0.0.1:<port>/v0 */
  baseUrl: string;
  /** Real sends only (no idempotent replays). */
  readonly sent: {
    inboxId: string;
    key: string;
    body: AgentMailSendRequest;
    displayName: string;
    messageId: string;
  }[];
  readonly requests: { method: string; path: string; authorization: string | null }[];
  failNext(op: FakeOp, response: FakeResponse, times?: number): void;
  /** Stores the send at once, then waits `holdMs` before it answers (the provider accepted the mail, the client timed out). `stop()` releases a held response at once; the answer goes to a closed connection. */
  // Only the next new send uses the hold; a replay, 409, 400 or failNext-ed send leaves it for a later send.
  holdResponseNext(op: "send", holdMs: number): void;
  stop(): Promise<void>;
}

const statusUntil = "2026-12-07T14:40:11.000Z";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export async function startFakeAgentMail(opts: { apiKey: string; now?: () => Date }): Promise<FakeAgentMail> {
  const now = opts.now ?? (() => new Date());
  const inboxes = new Map<string, FakeInbox>();
  const messages: StoredMessage[] = [];
  const keys = new Map<string, { inboxId: string; rawBody: string; messageId: string; threadId: string }>();
  const failures: { op: FakeOp; response: FakeResponse; times: number }[] = [];
  const holds: number[] = [];
  const held = new Set<{ timer: ReturnType<typeof setTimeout>; release: () => void }>();
  const sent: FakeAgentMail["sent"] = [];
  const requests: FakeAgentMail["requests"] = [];
  let counter = 0;

  function inboxJson(inbox: FakeInbox): Record<string, unknown> {
    return {
      inbox_id: inbox.inboxId,
      email: inbox.inboxId,
      display_name: inbox.displayName,
      status_until: statusUntil,
    };
  }

  function takeFailure(op: FakeOp): FakeResponse | null {
    const failure = failures.find((item) => item.op === op && item.times > 0);
    if (failure === undefined) {
      return null;
    }
    failure.times -= 1;
    return failure.response;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const entry = {
        timer: setTimeout(() => entry.release(), ms),
        release: () => {
          clearTimeout(entry.timer);
          held.delete(entry);
          resolve();
        },
      };
      held.add(entry);
    });
  }

  async function handleSend(inbox: FakeInbox, request: Request): Promise<Response> {
    const key = request.headers.get("Idempotency-Key");
    if (key === null || key === "") {
      return jsonResponse(400, { name: "ValidationError", message: "Idempotency-Key is required" });
    }
    const rawBody = await request.text();
    const seen = keys.get(key);
    if (seen !== undefined) {
      if (seen.inboxId !== inbox.inboxId || seen.rawBody !== rawBody) {
        return jsonResponse(409, { name: "IdempotencyKeyConflictError", code: "conflict" });
      }
      return jsonResponse(200, { message_id: seen.messageId, thread_id: seen.threadId });
    }
    const body = JSON.parse(rawBody) as AgentMailSendRequest;
    counter += 1;
    const messageId = `<fake-${counter}@email.amazonses.test>`;
    const threadId = `t-${counter}`;
    keys.set(key, { inboxId: inbox.inboxId, rawBody, messageId, threadId });
    messages.push({
      inboxId: inbox.inboxId,
      messageId,
      threadId,
      labels: body.labels ?? [],
      timestamp: now().toISOString(),
    });
    sent.push({ inboxId: inbox.inboxId, key, body, displayName: inbox.displayName, messageId });
    const hold = holds.shift();
    if (hold !== undefined) {
      await wait(hold);
    }
    return jsonResponse(200, { message_id: messageId, thread_id: threadId });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    requests.push({ method: request.method, path: url.pathname, authorization: request.headers.get("Authorization") });
    if (request.headers.get("Authorization") !== `Bearer ${opts.apiKey}`) {
      return jsonResponse(401, { name: "UnauthorizedError" });
    }
    const segments = url.pathname.split("/").filter((part) => part !== "");
    if (segments[0] !== "v0" || segments[1] !== "inboxes") {
      return jsonResponse(404, { name: "NotFoundError" });
    }
    const inboxId = segments[2] === undefined ? null : decodeURIComponent(segments[2]);

    if (inboxId === null) {
      if (request.method !== "POST") {
        return jsonResponse(404, { name: "NotFoundError" });
      }
      const failure = takeFailure("create");
      if (failure !== null) {
        return jsonResponse(failure.status, failure.body ?? {}, failure.headers);
      }
      const input = (await request.json()) as { username: string; client_id: string; display_name: string };
      const existing = [...inboxes.values()].find((item) => item.clientId === input.client_id);
      if (existing !== undefined) {
        return jsonResponse(200, inboxJson(existing));
      }
      const newInboxId = `${input.username}@agentmail.to`;
      if (inboxes.has(newInboxId)) {
        return jsonResponse(409, { name: "AlreadyExistsError" });
      }
      const created: FakeInbox = {
        inboxId: newInboxId,
        clientId: input.client_id,
        displayName: input.display_name,
      };
      inboxes.set(created.inboxId, created);
      return jsonResponse(200, inboxJson(created));
    }

    const rest = segments.slice(3).join("/");
    let op: FakeOp | null = null;
    if (rest === "" && request.method === "GET") op = "get";
    else if (rest === "" && request.method === "PATCH") op = "patch";
    else if (rest === "messages/send" && request.method === "POST") op = "send";
    else if (rest === "messages" && request.method === "GET") op = "list";
    if (op === null) {
      return jsonResponse(404, { name: "NotFoundError" });
    }
    const failure = takeFailure(op);
    if (failure !== null) {
      return jsonResponse(failure.status, failure.body ?? {}, failure.headers);
    }
    const inbox = inboxes.get(inboxId);
    if (inbox === undefined) {
      return jsonResponse(404, { name: "NotFoundError" });
    }
    if (op === "get") {
      return jsonResponse(200, inboxJson(inbox));
    }
    if (op === "patch") {
      const input = (await request.json()) as { display_name: string };
      inbox.displayName = input.display_name;
      return jsonResponse(200, inboxJson(inbox));
    }
    if (op === "send") {
      return handleSend(inbox, request);
    }
    const label = url.searchParams.get("labels");
    const found = messages
      .filter((item) => item.inboxId === inbox.inboxId && (label === null || item.labels.includes(label)))
      .reverse()
      .map((item) => ({
        message_id: item.messageId,
        thread_id: item.threadId,
        labels: item.labels,
        timestamp: item.timestamp,
      }));
    return jsonResponse(200, { count: found.length, messages: found });
  }

  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handle });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v0`,
    sent,
    requests,
    failNext(op, response, times = 1) {
      failures.push({ op, response, times });
    },
    holdResponseNext(_op, holdMs) {
      holds.push(holdMs);
    },
    async stop() {
      // Release each held response first: `server.stop(true)` must not wait for a handler that never ends
      // (Bun 1.3.14 waited; see docs/known-alerts.md).
      for (const entry of [...held]) {
        entry.release();
      }
      await server.stop(true);
    },
  };
}
