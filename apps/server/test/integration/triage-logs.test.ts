import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import { createLlmPause, createTriageJob } from "../../src/modules/triage";
import { createLlmClient, type GenerateFn } from "../../src/platform/llm";
import { setLogLevel } from "../../src/platform/log";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  setLogLevel("info");
});

const MARKERS = {
  key: "MARKER-KEY-0001",
  address: "marker-address-0002@scope.test",
  from: "marker-from-0003@sender.test",
  subject: "MARKER-SUBJECT-0004",
  body: "MARKER-BODY-0005",
  errorMessage: "MARKER-ERRMSG-0006",
  errorBody: "MARKER-ERRBODY-0007",
  summary: "MARKER-SUMMARY-0008",
  reason: "MARKER-REASON-0009",
};

const now = new Date("2026-11-05T12:00:00.000Z");

describe("triage logs", () => {
  test("no log line holds mail text, a summary, an error message, an error body or a key", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    setLogLevel("debug");
    try {
      await withRollback(db, async (trx) => {
        await pauseOtherMailboxes(trx);
        const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address: MARKERS.address });
        const ctx = { orgId };
        await insertDefaultSettings(trx, ctx, mailboxId);
        const mailId = await insertTestEmail(trx, ctx, mailboxId, {
          from_address: MARKERS.from,
          subject: MARKERS.subject,
          body_text: MARKERS.body,
        });

        const config400 = Object.assign(new Error("config"), {
          status: 400,
          message: JSON.stringify({
            error: {
              status: "INVALID_ARGUMENT",
              message: MARKERS.errorBody,
              details: [{ reason: "API_KEY_INVALID" }],
            },
          }),
        });
        const steps: (() => ReturnType<GenerateFn>)[] = [
          () => Promise.reject(Object.assign(new Error(MARKERS.errorMessage), { status: 503 })),
          () => Promise.reject(new Error(MARKERS.errorMessage)),
          () => Promise.reject(config400),
          () =>
            Promise.resolve({
              text: JSON.stringify({
                category: "info",
                confidence: 0.9,
                reason_code: "newsletter",
                reason: MARKERS.reason,
                summary: MARKERS.summary,
                fields: { due_date: null, language: "pl" },
              }),
              tokensIn: 10,
              tokensOut: 5,
              blocked: false,
            }),
        ];
        let calls = 0;
        const generate: GenerateFn = () => {
          const step = steps[calls];
          calls += 1;
          if (step === undefined) throw new Error("unexpected extra LLM call");
          return step();
        };

        const clock = { at: now };
        const triage = createTriageJob({
          db: trx,
          llm: createLlmClient({
            provider: "gemini",
            apiKey: MARKERS.key,
            classifierModel: "fake-model",
            timeoutMs: 1000,
            rpm: 1000,
            generate,
            sleep: async () => undefined,
          }),
          pause: createLlmPause(),
          scope: { kind: "all", mailboxAddress: MARKERS.address },
          batchSize: 5,
          dailyCap: 1000,
          now: () => clock.at,
        });

        // Each run moves the clock past the longest pause and the retry wait.
        for (let run = 0; run < 8 && calls < steps.length; run += 1) {
          await triage.run();
          clock.at = new Date(clock.at.getTime() + 70 * 60_000);
        }

        expect(calls).toBe(4);
        const row = await trx.selectFrom("emails").select("status").where("id", "=", mailId).executeTakeFirstOrThrow();
        expect(row.status).toBe("triaged");
      });

      const debugLines = logSpy.mock.calls.filter((call: unknown[]) => call[0] === "[llm]");
      expect(debugLines.length).toBeGreaterThan(0);
      const output = [...logSpy.mock.calls, ...errorSpy.mock.calls]
        .map((call: unknown[]) => call.map(String).join(" "))
        .join("\n");
      for (const marker of Object.values(MARKERS)) expect(output).not.toContain(marker);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
