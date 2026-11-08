import type { AgentMailSendRequest } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { HardError, SoftError } from "../../../platform/errors";

import {
  AgentMailError,
  createAgentMailClient,
  isIdempotencyConflict,
  isSoftAgentMailError,
  type AgentMailClient,
} from "./client";

const apiKey = "k-test-1234567890";
const baseUrl = "http://agentmail.invalid/v0";
const inboxId = "ea-x@agentmail.to";

const request: AgentMailSendRequest = {
  to: ["box@example.test"],
  subject: "Hello",
  text: "Body text",
  headers: { "X-EA-Testmail": "2026-11-08-a/c1" },
  labels: ["ea-testmail", "ea-case-a-c1"],
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function setup(respond: () => Response | Promise<Response>): { client: AgentMailClient; requests: Request[] } {
  const requests: Request[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return respond();
  }) as typeof fetch;
  return { client: createAgentMailClient({ apiKey, baseUrl, fetch: fakeFetch }), requests };
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
}

describe("AgentMail client", () => {
  test("send builds the request and maps the answer", async () => {
    const { client, requests } = setup(() => json({ message_id: "<m1@x>", thread_id: "t1" }));
    const sent = await client.send(inboxId, request, "key-1");
    expect(sent).toEqual({ messageId: "<m1@x>", threadId: "t1" });
    const [seen] = requests;
    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe(`${baseUrl}/inboxes/ea-x%40agentmail.to/messages/send`);
    expect(seen?.headers.get("Authorization")).toBe(`Bearer ${apiKey}`);
    expect(seen?.headers.get("Idempotency-Key")).toBe("key-1");
    expect(seen?.headers.get("Content-Type")).toBe("application/json");
    expect(await seen?.json()).toEqual(request);
  });

  test("a 409 key conflict keeps only safe tokens", async () => {
    const { client } = setup(() =>
      json({ name: "IdempotencyKeyConflictError", code: "conflict", message: "secret-looking text" }, 409)
    );
    const error = await failure(client.send(inboxId, request, "key-1"));
    expect(error).toBeInstanceOf(AgentMailError);
    const typed = error as AgentMailError;
    expect(typed.status).toBe(409);
    expect(typed.errorName).toBe("IdempotencyKeyConflictError");
    expect(typed.code).toBe("conflict");
    expect(isIdempotencyConflict(typed)).toBe(true);
    expect(isSoftAgentMailError(typed)).toBe(false);
    for (const text of [String(typed), typed.message]) {
      expect(text).not.toContain("secret-looking text");
      expect(text).not.toContain(apiKey);
    }
  });

  test("another 409 is soft", async () => {
    const { client } = setup(() => json({ name: "RequestInProgressError" }, 409));
    const error = await failure(client.send(inboxId, request, "key-1"));
    expect(isSoftAgentMailError(error)).toBe(true);
    expect(isIdempotencyConflict(error)).toBe(false);
  });

  test("429 reads Retry-After", async () => {
    const { client } = setup(() => json({ name: "RateLimitError" }, 429, { "Retry-After": "2" }));
    const error = (await failure(client.getInbox(inboxId))) as AgentMailError;
    expect(error.retryAfterSec).toBe(2);
    expect(isSoftAgentMailError(error)).toBe(true);

    const bad = setup(() => json({}, 429, { "Retry-After": "abc" }));
    const badError = (await failure(bad.client.getInbox(inboxId))) as AgentMailError;
    expect(badError.retryAfterSec).toBeNull();
  });

  test("503 is soft; 400 and 401 are not", async () => {
    for (const [status, soft] of [
      [503, true],
      [400, false],
      [401, false],
    ] as const) {
      const { client } = setup(() => new Response("not json", { status }));
      const error = await failure(client.getInbox(inboxId));
      expect(error).toBeInstanceOf(AgentMailError);
      expect(isSoftAgentMailError(error)).toBe(soft);
    }
  });

  test("a network error is a SoftError with a cause", async () => {
    const { client } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const error = await failure(client.send(inboxId, request, "key-1"));
    expect(error).toBeInstanceOf(SoftError);
    expect((error as SoftError).message).toBe("AgentMail send: network error");
    expect((error as SoftError).cause).toBeInstanceOf(TypeError);
  });

  test("a 2xx body that is not JSON is a SoftError", async () => {
    const { client } = setup(() => new Response("{broken", { status: 200 }));
    const error = await failure(client.send(inboxId, request, "key-1"));
    expect(error).toBeInstanceOf(SoftError);
  });

  test("a 2xx body stream that errors is a SoftError", async () => {
    const { client } = setup(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new Error("stream broke"));
        },
      });
      return new Response(body, { status: 200 });
    });
    const error = await failure(client.send(inboxId, request, "key-1"));
    expect(error).toBeInstanceOf(SoftError);
  });

  test("a 200 with {} is a HardError", async () => {
    const { client } = setup(() => json({}));
    const error = await failure(client.send(inboxId, request, "key-1"));
    expect(error).toBeInstanceOf(HardError);
    expect((error as HardError).message).toBe("AgentMail send: unexpected response");
  });

  test("ensureInbox, setDisplayName and getInbox map the inbox", async () => {
    const body = {
      inbox_id: inboxId,
      email: inboxId,
      display_name: "Ola",
      status_until: "2026-12-07T14:40:11.000Z",
    };
    const { client, requests } = setup(() => json(body));
    const expected = {
      inboxId,
      email: inboxId,
      displayName: "Ola",
      status: null,
      statusUntil: "2026-12-07T14:40:11.000Z",
    };
    expect(await client.ensureInbox({ username: "ea-x", clientId: "c1", displayName: "Ola" })).toEqual(expected);
    expect(await client.setDisplayName(inboxId, "Ola")).toEqual(expected);
    expect(await client.getInbox(inboxId)).toEqual(expected);
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v0/inboxes",
      "PATCH /v0/inboxes/ea-x%40agentmail.to",
      "GET /v0/inboxes/ea-x%40agentmail.to",
    ]);
  });

  test("listByLabel asks for the label and drops items without it", async () => {
    const item = (id: string, labels: string[]) => ({
      message_id: id,
      thread_id: "t",
      labels,
      timestamp: "2026-11-08T10:00:00Z",
    });
    const { client, requests } = setup(() => json({ count: 2, messages: [item("a", ["l1"]), item("b", ["other"])] }));
    const found = await client.listByLabel(inboxId, "l1");
    expect(found.map((m) => m.messageId)).toEqual(["a"]);
    expect(new URL(requests[0]?.url ?? "").search).toBe("?labels=l1&limit=20");
  });

  test("the key never appears in an error message", async () => {
    const cases: (() => Response)[] = [() => json({ message: apiKey }, 401), () => json({ name: apiKey }, 500)];
    for (const respond of cases) {
      const { client } = setup(respond);
      const error = (await failure(client.getInbox(inboxId))) as Error;
      expect(String(error)).not.toContain(apiKey);
    }
  });
});
