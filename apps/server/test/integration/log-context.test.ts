import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import { tenancyRoutes } from "../../src/modules/tenancy";
import { createLlmPause, createTriageJob } from "../../src/modules/triage";
import type { GenerateFn } from "../../src/platform/llm";
import { createFixedLlmClient } from "../../src/platform/llm/testing";
import { setLogFormat, setLogLevel } from "../../src/platform/log";
import { runJobTick } from "../../src/platform/scheduler";
import { countMailboxes, onboardingDeps } from "../../src/web";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const off = { kind: "off", reason: "env_off" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
  setLogFormat("text");
  setLogLevel("info");
});

afterAll(async () => {
  await db.destroy();
});

const classifierAnswer = JSON.stringify({
  category: "info",
  confidence: 0.9,
  reason_code: "newsletter",
  reason: "a newsletter",
  summary: "a summary",
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
});

describe("log context", () => {
  test("a job tick and an HTTP request at the same time each keep their own id", async () => {
    const org = await webOrg(db);
    orgs.push(org);
    // The app is built before the spies start: createApp logs without a context when the dist folder is missing.
    const app = webTestApp({
      db,
      sessions: { "good-owner": org.ownerId },
      routers: (api) =>
        api.route(
          "/",
          tenancyRoutes({
            db,
            now: () => new Date(),
            scopes: { triage: off, actions: off, send: off },
            countMailboxes: countMailboxes(db),
            operatorContact: null,
            sessions: async () => [],
            ...onboardingDeps(db, async () => "fake_ea_bot"),
          })
        ),
    });
    const logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
    let captured: unknown[][] = [];
    let res: Response | undefined;
    let mailStatus: string | undefined;

    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const { orgId, mailboxId } = await createOrgWithMailbox(trx, {});
        const ctx = { orgId };
        await insertDefaultSettings(trx, ctx, mailboxId);
        const mailId = await insertTestEmail(trx, ctx, mailboxId, {});
        const generate: GenerateFn = () =>
          Promise.resolve({ text: classifierAnswer, tokensIn: 10, tokensOut: 5, blocked: false });
        const triage = createTriageJob({
          db: trx,
          llm: createFixedLlmClient(generate, {
            model: "fake-model",
            apiKey: "fake-key",
            timeoutMs: 1000,
            rpm: 1000,
            sleep: async () => undefined,
          }),
          pause: createLlmPause(),
          scope: { kind: "all" },
          batchSize: 5,
          dailyCap: 1000,
          now: () => new Date("2026-11-20T10:00:00Z"),
        });

        setLogFormat("json");
        setLogLevel("debug");
        try {
          [, res] = await Promise.all([
            runJobTick("triage.worker", () => triage.run()),
            app.request("/api/me", as("good-owner")),
          ]);
        } finally {
          captured = [...logSpy.mock.calls, ...errorSpy.mock.calls];
          logSpy.mockRestore();
          errorSpy.mockRestore();
          setLogFormat("text");
          setLogLevel("info");
        }

        const row = await trx.selectFrom("emails").select("status").where("id", "=", mailId).executeTakeFirstOrThrow();
        mailStatus = row.status;
      });
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(res?.status).toBe(200);
    const requestId = res?.headers.get("x-request-id");
    expect(requestId).toMatch(UUID);

    const lines = captured.map((call) => {
      expect(call).toHaveLength(1);
      return JSON.parse(String(call[0])) as Record<string, unknown>;
    });

    const requestLines = lines.filter((line) => line.request_id === requestId);
    expect(requestLines.length).toBeGreaterThanOrEqual(1);
    for (const line of requestLines) {
      expect(line.job).toBeUndefined();
      expect(line.run_id).toBeUndefined();
    }

    const jobLines = lines.filter((line) => line.job === "triage.worker");
    expect(jobLines.length).toBeGreaterThanOrEqual(2);
    expect(jobLines.some((line) => line.event === "job_done")).toBe(true);
    expect(jobLines.some((line) => line.module !== "scheduler")).toBe(true);
    const runId = jobLines[0]?.run_id;
    expect(runId).toMatch(UUID);
    for (const line of jobLines) {
      expect(line.run_id).toBe(runId);
      expect(line.request_id).toBeUndefined();
    }

    const stray = lines.filter((line) => line.request_id !== requestId && line.run_id !== runId);
    expect(stray).toEqual([]);

    expect(mailStatus).toBe("triaged");
  }, 30_000);
});
