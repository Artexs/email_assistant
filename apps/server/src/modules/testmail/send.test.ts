import { buildSendRequest, idempotencyKey, type Batch, type PersonaFile, type SendLogLine } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createAgentMailClient, type AgentMailClient } from "./agentmail/client";
import { startFakeAgentMail, type FakeAgentMail } from "./agentmail/fake";
import { requestHash, runSend, type SendRunInput, type SendRunResult } from "./send";

const apiKey = "k-test-secret-1234567890";
const batchId = "2026-11-08-t";
const to = "boss@interia.test";
const hour = 3_600_000;

const personas: PersonaFile = {
  inbox: { username: "ea-t", clientId: "ea-t-client", defaultDisplayName: "Default Name" },
  personas: [
    { key: "anna", displayName: "Anna Kowalska", group: "work", lang: "pl", voice: "calm" },
    { key: "jan", displayName: "Jan Nowak", group: "work", lang: "pl", voice: "short" },
  ],
};

function makeCase(id: string, persona: string, replyTo?: string): Batch["cases"][number] {
  return {
    id,
    persona,
    lang: "pl",
    subject: `Subjectword ${id}`,
    body: `Bodyword ${id}`,
    expected: { category: "info" },
    ...(replyTo === undefined ? {} : { replyTo }),
  };
}

function makeBatch(cases: Batch["cases"]): Batch {
  return { batch: batchId, writer: "test", delegatesActive: false, cases };
}

const abcBatch = makeBatch([makeCase("a", "anna"), makeCase("b", "anna", "a"), makeCase("c", "jan")]);

let fake: FakeAgentMail;
let client: AgentMailClient;
let inboxId: string;
let clock: number;
let sleeps: number[];
let appended: SendLogLine[];

beforeEach(async () => {
  fake = await startFakeAgentMail({ apiKey });
  client = createAgentMailClient({ apiKey, baseUrl: fake.baseUrl, timeoutMs: 200 });
  inboxId = (await client.ensureInbox({ username: "ea-t", clientId: "ea-t-client", displayName: "Default Name" }))
    .inboxId;
  clock = Date.parse("2026-11-08T10:00:00.000Z");
  sleeps = [];
  appended = [];
});
afterEach(async () => {
  await fake.stop();
});

function run(
  overrides: Partial<SendRunInput> & { batch?: Batch } = {},
  deps: { client?: AgentMailClient } = {}
): Promise<SendRunResult> {
  const input: SendRunInput = {
    batch: abcBatch,
    personas,
    inboxId,
    to,
    lines: [],
    sentInLast24h: 0,
    dailyCap: 50,
    limit: null,
    intervalMs: 30_000,
    currentDisplayName: "Default Name",
    ...overrides,
  };
  return runSend(
    {
      client: deps.client ?? client,
      now: () => new Date(clock),
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      append: (line) => appended.push(line),
    },
    input
  );
}

function intentLine(caseId: string, hash: string, ageMs: number, attempt = 1): SendLogLine {
  return {
    type: "intent",
    batch: batchId,
    case: caseId,
    attempt,
    key: idempotencyKey(batchId, caseId, attempt),
    hash,
    at: new Date(clock - ageMs).toISOString(),
  };
}

function caseOf(id: string): Batch["cases"][number] {
  const found = abcBatch.cases.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no case ${id}`);
  return found;
}

function sentAt(index: number): FakeAgentMail["sent"][number] {
  const found = fake.sent[index];
  if (found === undefined) throw new Error(`no send ${index}`);
  return found;
}

function hashOf(caseId: string): string {
  const testCase = caseOf(caseId);
  return requestHash(inboxId, buildSendRequest({ batchId, testCase, to, parentMessageId: null }));
}

/** A mail of case `a` that the fake already holds under the key of attempt 1. */
async function preSend(caseId: string, key = idempotencyKey(batchId, caseId, 1)): Promise<string> {
  const testCase = caseOf(caseId);
  const request = buildSendRequest({ batchId, testCase, to, parentMessageId: null });
  return (await client.send(inboxId, request, key)).messageId;
}

function sendCalls(): number {
  return fake.requests.filter((item) => item.method === "POST" && item.path.endsWith("/messages/send")).length;
}

describe("runSend", () => {
  test("1: sends a, b, c in order with intent before sent", async () => {
    const result = await run();
    expect(result.sent).toEqual(["a", "b", "c"]);
    expect(result.exitCode).toBe(0);
    expect(fake.sent).toHaveLength(3);
    const first = sentAt(0);
    expect(sentAt(1).body.headers["In-Reply-To"]).toBe(first.messageId);
    expect(appended.map((line) => `${line.type}:${line.case}`)).toEqual([
      "intent:a",
      "sent:a",
      "intent:b",
      "sent:b",
      "intent:c",
      "sent:c",
    ]);
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  test("2: a repeat with the full log sends nothing", async () => {
    await run();
    const lines = [...appended];
    appended = [];
    const before = sendCalls();
    const result = await run({ lines });
    expect(result.exitCode).toBe(0);
    expect(result.sent).toEqual([]);
    expect(sendCalls()).toBe(before);
    expect(appended).toEqual([]);
  });

  test("3: a lost response is repeated with the same key", async () => {
    fake.holdResponseNext("send", 1000);
    const result = await run({ batch: makeBatch([makeCase("a", "anna")]) });
    expect(result.sent).toEqual(["a"]);
    expect(sleeps).toEqual([5000]);
    expect(fake.sent).toHaveLength(1);
    expect(appended.filter((line) => line.type === "intent")).toHaveLength(1);
    const sentLine = appended.find((line) => line.type === "sent");
    expect(sentLine?.type === "sent" && sentLine.messageId).toBe(sentAt(0).messageId);
  });

  test("4: an open intent of 1 h reuses the key", async () => {
    const firstId = await preSend("a");
    const result = await run({ lines: [intentLine("a", hashOf("a"), hour)], batch: makeBatch([caseOf("a")]) });
    expect(result.sent).toEqual(["a"]);
    expect(appended.filter((line) => line.type === "intent")).toEqual([]);
    expect(fake.sent).toHaveLength(1);
    const sentLine = appended.find((line) => line.type === "sent");
    expect(sentLine?.type === "sent" && sentLine.messageId).toBe(firstId);
  });

  test("5: an open intent of 13 h recovers by label", async () => {
    const firstId = await preSend("a");
    const before = sendCalls();
    const result = await run({
      lines: [intentLine("a", hashOf("a"), 13 * hour)],
      batch: makeBatch([caseOf("a")]),
    });
    expect(result.recovered).toEqual(["a"]);
    expect(result.sent).toEqual([]);
    expect(sendCalls()).toBe(before);
    const sentLine = appended.find((line) => line.type === "sent");
    expect(sentLine?.type === "sent" && sentLine.via).toBe("label");
    expect(sentLine?.type === "sent" && sentLine.messageId).toBe(firstId);
  });

  test("6: an open intent of 13 h without a mail makes attempt 2", async () => {
    const result = await run({
      lines: [intentLine("a", hashOf("a"), 13 * hour)],
      batch: makeBatch([caseOf("a")]),
    });
    expect(result.sent).toEqual(["a"]);
    const intent = appended.find((line) => line.type === "intent");
    expect(intent?.type === "intent" && intent.attempt).toBe(2);
    expect(intent?.type === "intent" && intent.key).toBe(`ea-${batchId}-a-a2`);
    expect(fake.sent).toHaveLength(1);
    expect(sentAt(0).key).toBe(`ea-${batchId}-a-a2`);
  });

  test("7: two mails with the label stop the run", async () => {
    await preSend("a", "other-key-1");
    await preSend("a", "other-key-2");
    const before = sendCalls();
    const result = await run({
      lines: [intentLine("a", hashOf("a"), 13 * hour)],
      batch: makeBatch([caseOf("a")]),
    });
    expect(result.stoppedBy).toBe("duplicate_found");
    expect(result.exitCode).toBe(1);
    expect(sendCalls()).toBe(before);
    expect(appended).toEqual([]);
  });

  test("8: an open intent with another hash blocks the reply, others go on", async () => {
    const before = sendCalls();
    const result = await run({ lines: [intentLine("a", "f".repeat(64), hour)] });
    expect(result.sent).toEqual(["c"]);
    expect(result.remaining).toEqual([
      { caseId: "a", reason: "changed" },
      { caseId: "b", reason: "blocked" },
    ]);
    expect(result.exitCode).toBe(1);
    expect(sendCalls() - before).toBe(1);
  });

  test("9: 429 on every send waits 1, 2, 4 s and stops", async () => {
    fake.failNext("send", { status: 429, body: { name: "RateLimitError" } }, 4);
    const result = await run();
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(result.stoppedBy).toBe("rate_limit");
    expect(result.exitCode).toBe(2);
    expect(result.remaining[0]).toEqual({ caseId: "a", reason: "open" });
    expect(fake.sent).toHaveLength(0);
  });

  test("10: an idempotency conflict fails the case", async () => {
    fake.failNext("send", { status: 409, body: { name: "IdempotencyKeyConflictError" } });
    const result = await run();
    expect(result.failed).toEqual([{ caseId: "a", code: "idempotency_conflict" }]);
    expect(result.sent).toEqual(["c"]);
    expect(result.remaining).toEqual([{ caseId: "b", reason: "blocked" }]);
    expect(result.exitCode).toBe(1);
  });

  test("11: two 403 in a row stop the run; a 401 stops at once", async () => {
    fake.failNext("send", { status: 403, body: { name: "ForbiddenError" } }, 2);
    const forbidden = await run({
      batch: makeBatch([makeCase("a", "anna"), makeCase("b", "anna", "a"), makeCase("c", "jan"), makeCase("d", "jan")]),
    });
    expect(forbidden.failed.map((item) => item.code)).toEqual(["http_403", "http_403"]);
    expect(forbidden.stoppedBy).toBe("rejected");
    expect(forbidden.exitCode).toBe(1);
    expect(fake.sent).toHaveLength(0);

    appended = [];
    fake.failNext("send", { status: 401, body: { name: "UnauthorizedError" } });
    const auth = await run();
    expect(auth.stoppedBy).toBe("auth");
    expect(auth.exitCode).toBe(1);
    expect(fake.sent).toHaveLength(0);
  });

  test("12: the daily cap stops after one send", async () => {
    const result = await run({ sentInLast24h: 49, dailyCap: 50 });
    expect(result.sent).toEqual(["a"]);
    expect(result.stoppedBy).toBe("cap");
    expect(result.exitCode).toBe(2);
  });

  test("13: the display name changes only when the persona changes", async () => {
    await run();
    const patches = fake.requests.filter((item) => item.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(fake.sent.map((item) => item.displayName)).toEqual(["Anna Kowalska", "Anna Kowalska", "Jan Nowak"]);
  });

  test("14: every mail goes to the test address only and the log holds no mail text", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      fake.failNext("send", { status: 429, body: {} });
      fake.failNext("send", { status: 403, body: {} }, 1);
      await run();
      const output = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(" ")).join("\n");
      expect(output).toContain("sent");
      for (const secret of ["Subjectword", "Bodyword", "Anna", "Jan", apiKey, to]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    expect(fake.sent.length).toBeGreaterThan(0);
    for (const item of fake.sent) {
      expect(item.body.to).toEqual([to]);
    }
  });

  test("17: a 403 on setDisplayName stops the run before any send", async () => {
    fake.failNext("patch", { status: 403, body: { name: "ForbiddenError" } });
    const result = await run({ batch: makeBatch([makeCase("a", "anna")]) });
    expect(result.stoppedBy).toBe("rejected");
    expect(result.exitCode).toBe(1);
    expect(fake.sent).toHaveLength(0);
    expect(sendCalls()).toBe(0);
    expect(appended.map((line) => line.type)).toEqual(["intent"]);
  });

  test("18: a 503 on send waits 5 s and the case is sent", async () => {
    fake.failNext("send", { status: 503, body: {} }, 1);
    const result = await run({ batch: makeBatch([makeCase("a", "anna")]) });
    expect(sleeps).toEqual([5000]);
    expect(result.sent).toEqual(["a"]);
    expect(fake.sent).toHaveLength(1);
  });

  test("19: a 400 resets the count of 403 in a row", async () => {
    fake.failNext("send", { status: 400, body: {} });
    fake.failNext("send", { status: 403, body: {} });
    const result = await run({
      batch: makeBatch([makeCase("a", "anna"), makeCase("b", "anna"), makeCase("c", "jan")]),
    });
    expect(result.failed.map((item) => item.code)).toEqual(["http_400", "http_403"]);
    expect(result.sent).toEqual(["c"]);
    expect(result.stoppedBy).toBeNull();
  });

  test("20: a 404 on send stops with inbox_missing", async () => {
    fake.failNext("send", { status: 404, body: {} });
    const result = await run();
    expect(result.stoppedBy).toBe("inbox_missing");
    expect(result.exitCode).toBe(1);
    expect(fake.sent).toHaveLength(0);
  });

  test("21: limit 1 where a gets 400 fails a and stops by limit", async () => {
    fake.failNext("send", { status: 400, body: {} });
    const result = await run({ limit: 1 });
    expect(result.failed).toEqual([{ caseId: "a", code: "http_400" }]);
    expect(result.stoppedBy).toBe("limit");
    expect(result.exitCode).toBe(1);
    expect(fake.sent).toHaveLength(0);
  });

  test("22: limit 1 on a 13 h old intent without a mail sends exactly once", async () => {
    const result = await run({
      lines: [intentLine("a", hashOf("a"), 13 * hour)],
      batch: makeBatch([caseOf("a")]),
      limit: 1,
    });
    expect(result.sent).toEqual(["a"]);
    expect(fake.sent).toHaveLength(1);
    expect(sendCalls()).toBe(1);
  });

  test("23: a 401 on setDisplayName or on the label search stops with auth", async () => {
    fake.failNext("patch", { status: 401, body: {} });
    const patch = await run({ batch: makeBatch([makeCase("a", "anna")]) });
    expect(patch.stoppedBy).toBe("auth");
    expect(patch.exitCode).toBe(1);

    fake.failNext("list", { status: 401, body: {} });
    const list = await run({
      lines: [intentLine("a", hashOf("a"), 13 * hour)],
      batch: makeBatch([caseOf("a")]),
    });
    expect(list.stoppedBy).toBe("auth");
    expect(fake.sent).toHaveLength(0);
  });
});
