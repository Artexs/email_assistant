import { afterEach, expect, test } from "bun:test";
import { z } from "zod";

import { buildTriageAnalysisSchema } from "@ea/core";

import { DEMO_SEED_FORMAT, DEMO_TABLES, type DemoSeed } from "../../../apps/server/src/modules/lab";
import { createOpenAiGenerate } from "../../../apps/server/src/platform/llm/providers/openai";

import { buildReplayTable } from "./replay";
import { startReplayServer, type ReplayServer } from "./server";

const NEEDLE = "sk-test-123";
const quietLog: string[] = [];
let server: ReplayServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

function table() {
  const tables = Object.fromEntries(
    DEMO_TABLES.map((name) => [name, [] as Record<string, unknown>[]])
  ) as unknown as DemoSeed["tables"];
  tables.emails.push({ id: "e1", from_address: "ops@kordelan.test", subject: "Server down" });
  tables.triage_results.push({
    email_id: "e1",
    category: "urgent",
    confidence: 0.9,
    reason_code: "other",
    reason: "r",
    fields: {},
    created_at: "2026-11-23T10:00:00.000Z",
  });
  return buildReplayTable({ format: DEMO_SEED_FORMAT, scenario: "s", runId: "r", day: 1, exportedAt: "x", tables });
}

const input =
  "The email to classify:\n<<<EMAIL_DATA N>>>\nFrom: ops@kordelan.test\nTo: a\nCc: \nSubject: Server down\n<<<END_EMAIL_DATA N>>>";
const post = (port: number, path: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers, body: JSON.stringify({ model: "m", input }) });

test("a replayed call answers in the Responses form and the stats count it", async () => {
  server = await startReplayServer(table(), { log: (line) => void quietLog.push(line) });
  const response = await post(server.port, "/v1/responses");
  const body = (await response.json()) as { output: { content: { text: string }[] }[] };
  expect(response.status).toBe(200);
  expect(JSON.parse(body.output[0]?.content[0]?.text ?? "").category).toBe("urgent");
  const stats = await fetch(`http://127.0.0.1:${server.port}/_replay/stats`);
  expect(await stats.json()).toEqual({ hits: 1, misses: 0 });
});

test("another path is 404 and not a miss", async () => {
  server = await startReplayServer(table(), { log: (line) => void quietLog.push(line) });
  expect((await post(server.port, "/v1/chat/completions")).status).toBe(404);
  expect(server.stats()).toEqual({ hits: 0, misses: 0 });
});

test("a log line holds the path, status and reason code and never the key or the mail", async () => {
  const lines: string[] = [];
  server = await startReplayServer(table(), { log: (line) => lines.push(line) });
  await post(server.port, "/v1/responses", { authorization: `Bearer ${NEEDLE}` });
  expect(lines).toEqual(["replay /v1/responses 200 other"]);
});

test("the production OpenAI adapter reads the answer through the SDK", async () => {
  server = await startReplayServer(table(), { log: (line) => void quietLog.push(line) });
  const generate = createOpenAiGenerate({
    apiKey: NEEDLE,
    reasoningEffort: null,
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    endpoint: "own",
  });
  const schema = buildTriageAnalysisSchema(["urgent", "info"]);
  const result = await generate({
    model: "m",
    system: "s",
    prompt: input,
    jsonSchema: z.toJSONSchema(schema),
    signal: AbortSignal.timeout(5000),
  });
  expect(schema.parse(JSON.parse(result.text ?? "")).category).toBe("urgent");
  expect(server.stats()).toEqual({ hits: 1, misses: 0 });
});
