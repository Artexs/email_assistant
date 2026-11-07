import { buildSendRequest, caseLabel, type AgentMailSendRequest } from "@ea/core";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { SoftError } from "../../../platform/errors";

import { createAgentMailClient, isIdempotencyConflict, isSoftAgentMailError, type AgentMailClient } from "./client";
import { startFakeAgentMail, type FakeAgentMail } from "./fake";

const apiKey = "k-test-1234567890";

const request: AgentMailSendRequest = {
  to: ["box@example.test"],
  subject: "Hello",
  text: "Body text",
  headers: { "X-EA-Testmail": "2026-11-08-a/c1" },
  labels: ["ea-testmail", "ea-case-a-c1"],
};

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
}

let fake: FakeAgentMail;
let client: AgentMailClient;
let inboxId: string;

beforeEach(async () => {
  fake = await startFakeAgentMail({ apiKey, now: () => new Date("2026-11-08T10:00:00.000Z") });
  client = createAgentMailClient({ apiKey, baseUrl: fake.baseUrl });
  inboxId = (await client.ensureInbox({ username: "ea-x", clientId: "c-1", displayName: "Anna" })).inboxId;
});

afterEach(async () => {
  await fake.stop();
});

describe("AgentMail fake", () => {
  test("create with the same client_id returns the same inbox", async () => {
    const again = await client.ensureInbox({ username: "ea-other", clientId: "c-1", displayName: "Other" });
    expect(again.inboxId).toBe(inboxId);
    expect(inboxId).toBe("ea-x@agentmail.to");
    expect(fake.requests.filter((item) => item.method === "POST" && item.path === "/v0/inboxes")).toHaveLength(2);
    expect((await client.getInbox(inboxId)).statusUntil).toBe("2026-12-07T14:40:11.000Z");
  });

  test("create with a new client_id and an existing username gives 409", async () => {
    const error = await failure(client.ensureInbox({ username: "ea-x", clientId: "c-2", displayName: "Other" }));
    expect(error).toMatchObject({ status: 409, errorName: "AlreadyExistsError" });
    expect((await client.getInbox(inboxId)).inboxId).toBe(inboxId);
  });

  test("same key and body replays; another body conflicts", async () => {
    const first = await client.send(inboxId, request, "k1");
    const second = await client.send(inboxId, request, "k1");
    expect(second.messageId).toBe(first.messageId);
    expect(first.messageId).toMatch(/^<fake-\d+@email\.amazonses\.test>$/);
    expect(fake.sent).toHaveLength(1);
    const error = await failure(client.send(inboxId, { ...request, subject: "Other" }, "k1"));
    expect(isIdempotencyConflict(error)).toBe(true);
    expect(fake.sent).toHaveLength(1);
  });

  test("send without a key gives 400", async () => {
    const response = await fetch(`${fake.baseUrl}/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(400);
    expect(fake.sent).toHaveLength(0);
  });

  test("wrong key gives 401 and an unknown inbox gives 404", async () => {
    const wrong = createAgentMailClient({ apiKey: "k-wrong-1234567890", baseUrl: fake.baseUrl });
    const unauthorized = await failure(wrong.getInbox(inboxId));
    expect(isSoftAgentMailError(unauthorized)).toBe(false);
    expect(String(unauthorized)).toContain("HTTP 401 UnauthorizedError");
    expect(String(await failure(client.getInbox("nobody@agentmail.to")))).toContain("HTTP 404 NotFoundError");
    expect(String(await failure(client.send("nobody@agentmail.to", request, "k9")))).toContain("HTTP 404");
    expect(String(await failure(client.setDisplayName("nobody@agentmail.to", "X")))).toContain("HTTP 404");
  });

  test("listByLabel finds the message by its case label", async () => {
    const sent = await client.send(
      inboxId,
      buildSendRequest({
        batchId: "2026-11-08-a",
        testCase: {
          id: "c1",
          persona: "p",
          lang: "en",
          subject: "S",
          body: "B",
          expected: { category: "info" },
        },
        to: "box@example.test",
        parentMessageId: null,
      }),
      "k2"
    );
    const found = await client.listByLabel(inboxId, caseLabel("2026-11-08-a", "c1"));
    expect(found.map((item) => item.messageId)).toEqual([sent.messageId]);
    expect(found[0]?.timestamp).toBe("2026-11-08T10:00:00.000Z");
    expect(await client.listByLabel(inboxId, "ea-case-unknown")).toEqual([]);
  });

  test("failNext gives a soft 429 once, then the call works", async () => {
    fake.failNext("send", { status: 429, headers: { "Retry-After": "1" } });
    const error = await failure(client.send(inboxId, request, "k3"));
    expect(isSoftAgentMailError(error)).toBe(true);
    expect((error as { retryAfterSec: number }).retryAfterSec).toBe(1);
    expect(fake.sent).toHaveLength(0);
    const sent = await client.send(inboxId, request, "k3");
    expect(fake.sent.map((item) => item.messageId)).toEqual([sent.messageId]);
  });

  test("holdResponseNext: the client times out, the mail is stored, a repeat returns the stored id", async () => {
    fake.holdResponseNext("send", 1000);
    const slow = createAgentMailClient({ apiKey, baseUrl: fake.baseUrl, timeoutMs: 200 });
    const error = await failure(slow.send(inboxId, request, "k4"));
    expect(error).toBeInstanceOf(SoftError);
    expect(fake.sent).toHaveLength(1);
    const repeat = await client.send(inboxId, request, "k4");
    expect(repeat.messageId).toBe(fake.sent[0]?.messageId as string);
    expect(fake.sent).toHaveLength(1);
  });

  test("listByLabel drops items without the label when the server ignores the filter", async () => {
    fake.failNext("list", {
      status: 200,
      body: {
        count: 1,
        messages: [{ message_id: "<x@y>", thread_id: "t", labels: ["other"], timestamp: "2026-11-08T10:00:00.000Z" }],
      },
    });
    expect(await client.listByLabel(inboxId, "ea-case-a-c1")).toEqual([]);
  });

  test("setDisplayName changes the display name of the next send", async () => {
    await client.send(inboxId, request, "k5");
    await client.setDisplayName(inboxId, "Bartek");
    await client.send(inboxId, { ...request, subject: "Second" }, "k6");
    expect(fake.sent.map((item) => item.displayName)).toEqual(["Anna", "Bartek"]);
  });

  test("stop closes the port", async () => {
    const other = await startFakeAgentMail({ apiKey });
    const url = other.baseUrl;
    await other.stop();
    expect(await failure(fetch(`${url}/inboxes/x`))).toBeDefined();
  });
});
