import { createHash } from "node:crypto";

import { type EvalCase, type LlmRole } from "@ea/core";
import { describe, expect, test } from "bun:test";

import {
  LlmBlockedError,
  type LlmCall,
  LlmOutputError,
  type LlmClient,
  type LlmUsage,
  LlmSoftError,
} from "../../platform/llm";

import { EMPTY_EXTRAS } from "./classifier";
import { parseCaseResults, runEval } from "./eval";
import { escalationSignalsOfCase, missesOf } from "./eval-escalation";
import { renderEvalReport } from "./eval-report";
import { type ClassifierPrompt, classifierVersions, prompts } from "./prompts";

const CLASSIFIER_MODEL = "gpt-6-luna";
const ESCALATION_MODEL = "gpt-6.1-terra";

function answer(category: string, confidence = 0.95): Record<string, unknown> {
  return {
    category,
    confidence,
    reason_code: "other",
    reason: "Because.",
    summary: category === "info" ? "Short summary." : null,
    fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
  };
}

interface Request {
  role: LlmRole;
  promptVersion: string;
  model: string | undefined;
  system: string;
  prompt: string;
}

type Step = Record<string, unknown> | Error;

// A fake LLM with one script per role: the n-th call of a role takes its n-th step; the last step repeats.
// The usage names the model of the role, so the cost split can tell the calls apart. No real call.
function fakeLlm(script: { classifier: Step[]; escalation?: Step[] }) {
  const requests: Request[] = [];
  const counts: Record<string, number> = {};
  const llm: LlmClient = {
    modelOf: (role) => (role === "escalation" ? ESCALATION_MODEL : CLASSIFIER_MODEL),
    endpointOf: () => "standard",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const role = req.role as LlmRole;
      requests.push({
        role,
        promptVersion: req.promptVersion,
        model: req.model,
        system: req.system,
        prompt: req.prompt,
      });
      const steps = (role === "escalation" ? script.escalation : script.classifier) ?? [];
      const n = counts[role] ?? 0;
      counts[role] = n + 1;
      const step = steps[Math.min(n, steps.length - 1)];
      if (step === undefined) throw new Error(`no ${role} step`);
      if (step instanceof Error) throw step;
      const usage: LlmUsage = {
        role,
        promptVersion: req.promptVersion,
        model: role === "escalation" ? ESCALATION_MODEL : CLASSIFIER_MODEL,
        tokensIn: 1000,
        tokensOut: 100,
        latencyMs: 5,
        endpoint: "standard",
      };
      return { data: step as T, usage };
    },
  };
  return { llm, requests, callsOf: (role: LlmRole) => requests.filter((r) => r.role === role) };
}

function makeCase(over: Partial<EvalCase> & { headers?: Record<string, string> } = {}): EvalCase {
  const { headers, ...rest } = over;
  return {
    id: "c1",
    kind: "synthetic",
    lang: "en",
    from: "someone@sender.test",
    to: ["boss@firma.test"],
    cc: [],
    subject: "Subject",
    body: "Body",
    thread: [],
    senderRules: [],
    delegates: [],
    expected: { category: "info" },
    ...(headers === undefined
      ? {}
      : {
          sim: {
            corpus: "t",
            version: "1",
            part: "dev" as const,
            slotId: "s",
            hardCases: [],
            headers,
            attachments: [],
          },
        }),
    ...rest,
  };
}

const deps = (llm: LlmClient) => ({
  llm,
  sleep: async () => undefined,
  now: () => new Date("2026-11-15T12:00:00Z"),
});

const base = { model: CLASSIFIER_MODEL, provider: "openai" as const, bar: 0.98, minKept: 30, retries: 0 };
const escalation = { provider: "openai" as const, model: ESCALATION_MODEL, host: null, reasoningEffort: "none" };

// Test 5 of stage 12.
function threeCases(): EvalCase[] {
  return [
    makeCase({ id: "person", expected: { category: "needs_reply" } }),
    makeCase({ id: "list", expected: { category: "notification" }, headers: { "List-Id": "<news.sender.test>" } }),
    makeCase({ id: "urgent", expected: { category: "urgent" } }),
  ];
}

describe("runEval --escalate", () => {
  test("a person mail answered spam gets one second call; the cascade wins; H drops from 1 to 0", async () => {
    // Classifier: spam for the person mail, notification for the list mail, urgent for the urgent mail.
    // Escalation: needs_reply (it is called once).
    const fake = fakeLlm({
      classifier: [answer("spam"), answer("notification"), answer("urgent")],
      escalation: [answer("needs_reply")],
    });
    const report = await runEval(deps(fake.llm), { ...base, cases: threeCases(), escalation });
    expect(fake.callsOf("escalation")).toHaveLength(1);
    expect(fake.callsOf("classifier")).toHaveLength(3);

    const person = report.cases.find((c) => c.id === "person");
    expect(person?.finalCategory).toBe("needs_reply");
    expect(person?.escalation?.first).toMatchObject({ modelCategory: "spam", finalCategory: "spam", confidence: 0.95 });
    expect(person?.escalationUsage?.model).toBe(ESCALATION_MODEL);
    expect(report.cases.find((c) => c.id === "list")?.escalation).toBeNull();
    expect(report.cases.find((c) => c.id === "urgent")?.escalation).toBeNull();

    const esc = report.escalation;
    expect(esc).not.toBeNull();
    expect(esc?.triggered).toBe(1);
    expect(esc?.answered).toBe(3);
    expect(esc?.changed).toEqual({ "spam->needs_reply": 1 });
    expect(esc?.first.misses.h).toBe(1);
    expect(esc?.cascade.misses.h).toBe(0);
    expect(report.errors).toBe(0);
    // The main metrics show the cascade.
    expect(report.metrics.needs_reply.tp).toBe(1);
    expect(report.predictions.map((p) => p.predicted)).toEqual(["needs_reply", "notification", "urgent"]);
  });

  test("K counts urgent missed, hidden needs_reply and spam false positives, for the first answers and the cascade", async () => {
    const fake = fakeLlm({
      classifier: [answer("spam"), answer("spam"), answer("info")],
      escalation: [answer("needs_reply"), answer("urgent"), answer("info")],
    });
    const cases = [
      makeCase({ id: "a", expected: { category: "needs_reply" } }),
      makeCase({ id: "b", expected: { category: "urgent" } }),
      makeCase({ id: "c", expected: { category: "info" } }),
    ];
    const report = await runEval(deps(fake.llm), { ...base, cases, escalation });
    // First: a needs_reply hidden by spam (1) + b urgent missed (1) + spam false positives on a and b (2) = 4.
    expect(report.escalation?.first.misses).toEqual({
      urgentMissed: 1,
      needsReplyHidden: 1,
      spamFalsePositives: 2,
      k: 4,
      h: 2,
    });
    expect(report.escalation?.cascade.misses).toEqual({
      urgentMissed: 0,
      needsReplyHidden: 0,
      spamFalsePositives: 0,
      k: 0,
      h: 0,
    });
    expect(report.escalation?.changed).toEqual({ "spam->needs_reply": 1, "spam->urgent": 1 });
  });

  test("the second call has the same system text and user text as the first, and names no first answer", async () => {
    const fake = fakeLlm({ classifier: [answer("spam")], escalation: [answer("needs_reply")] });
    await runEval(deps(fake.llm), { ...base, cases: [makeCase({ id: "p" })], escalation });
    const [first] = fake.callsOf("classifier");
    const [second] = fake.callsOf("escalation");
    const strip = (text: string) => text.replace(/[0-9a-f]{32}/g, "NONCE");
    expect(second?.promptVersion).toBe("escalation-v1");
    expect(second?.model).toBe(ESCALATION_MODEL);
    expect(strip(second?.system ?? "")).toBe(strip(first?.system ?? ""));
    expect(strip(second?.prompt ?? "")).toBe(strip(first?.prompt ?? ""));
    // A different nonce for each call.
    expect(second?.prompt).not.toBe(first?.prompt);
  });

  test("a threshold cut (unsure) escalates, also for list mail; its second answer passes the same threshold", async () => {
    const fake = fakeLlm({
      classifier: [answer("needs_reply", 0.2)],
      escalation: [answer("needs_reply", 0.2)],
    });
    const listCase = makeCase({
      id: "l",
      expected: { category: "needs_reply" },
      headers: { "List-Unsubscribe": "<mailto:u@sender.test>" },
    });
    const report = await runEval(deps(fake.llm), { ...base, cases: [listCase], escalation });
    expect(fake.callsOf("escalation")).toHaveLength(1);
    // The second answer is under the threshold too: it wins as `unsure`.
    expect(report.cases[0]?.finalCategory).toBe("unsure");
    expect(report.cases[0]?.escalation?.first.finalCategory).toBe("unsure");
  });

  test("a hard-rule spam, a blocked first call and an auto-submitted mail never escalate", async () => {
    const fake = fakeLlm({
      classifier: [new LlmBlockedError("m"), answer("notification")],
      escalation: [answer("needs_reply")],
    });
    const cases = [
      makeCase({ id: "rule", senderRules: [{ kind: "blocklist", pattern: "someone@sender.test" }] }),
      makeCase({ id: "blocked", from: "other@sender.test" }),
      makeCase({
        id: "auto",
        from: "auto@sender.test",
        expected: { category: "notification" },
        headers: { "Auto-Submitted": "auto-generated" },
      }),
    ];
    const report = await runEval(deps(fake.llm), { ...base, cases, escalation });
    expect(fake.callsOf("escalation")).toHaveLength(0);
    expect(report.escalation?.triggered).toBe(0);
  });

  test("an escalation error ends the case as an error with the first call's usage; three in a row stop the run", async () => {
    const fake = fakeLlm({
      classifier: [answer("spam")],
      escalation: [new LlmOutputError(ESCALATION_MODEL, ["fields.task:too_big"])],
    });
    const cases = ["a", "b", "c", "d", "e"].map((id) => makeCase({ id }));
    const report = await runEval(deps(fake.llm), { ...base, cases, escalation });
    expect(report.cases.map((c) => c.errorCode)).toEqual(["bad_output", "bad_output", "bad_output"]);
    expect(report.complete).toBe(false);
    expect(report.stoppedReason).toContain("in a row");
    expect(report.cases[0]?.usage?.model).toBe(CLASSIFIER_MODEL);
    expect(report.cases[0]?.finalCategory).toBeNull();
    expect(fake.callsOf("escalation")).toHaveLength(3);
  });

  test("a soft error of the second call retries it, not the first call", async () => {
    const fake = fakeLlm({
      classifier: [answer("spam")],
      escalation: [new LlmSoftError("http_503", ESCALATION_MODEL), answer("needs_reply")],
    });
    const report = await runEval(deps(fake.llm), {
      ...base,
      retries: 2,
      cases: [makeCase({ id: "p" })],
      escalation,
    });
    expect(fake.callsOf("classifier")).toHaveLength(1);
    expect(fake.callsOf("escalation")).toHaveLength(2);
    expect(report.cases[0]?.finalCategory).toBe("needs_reply");
  });

  test("a blocked second call ends the case as unsure and counts as blocked", async () => {
    const fake = fakeLlm({ classifier: [answer("spam")], escalation: [new LlmBlockedError(ESCALATION_MODEL)] });
    const report = await runEval(deps(fake.llm), { ...base, cases: [makeCase({ id: "p" })], escalation });
    expect(report.cases[0]).toMatchObject({ finalCategory: "unsure", blocked: true, errorCode: null });
    expect(report.cases[0]?.escalation?.first.finalCategory).toBe("spam");
  });

  test("both calls count in the budget: a cap that fits one call per mail stops the run before the third mail", async () => {
    const fake = fakeLlm({ classifier: [answer("spam")], escalation: [answer("needs_reply")] });
    // Per mail: 1100 tokens in+out of each call. luna 1000*0.1 + 100*0.5 = 150 / 1e6; terra 1000*1 + 100*5 = 1500 / 1e6.
    const perMail = 0.00165;
    const spent: number[] = [];
    const report = await runEval(deps(fake.llm), {
      ...base,
      cases: ["a", "b", "c", "d"].map((id) => makeCase({ id })),
      escalation,
      budget: {
        capUsd: perMail * 2.5,
        callCostUsd: (usage) => (usage.model === ESCALATION_MODEL ? 0.0015 : 0.00015),
        firstEstimateUsd: perMail,
        onSpend: (usd) => spent.push(usd),
      },
    });
    expect(report.cases.map((c) => c.id)).toEqual(["a", "b"]);
    expect(report.cost.stoppedByBudget).toBe(true);
    expect(report.cost.spentUsd).toBeCloseTo(perMail * 2, 10);
    expect(spent.reduce((total, usd) => total + usd, 0)).toBeCloseTo(perMail * 2, 10);
  });

  test("a resumed state does not repeat a stored escalation call, and keeps both answers", async () => {
    const first = fakeLlm({
      classifier: [answer("spam"), answer("notification"), answer("urgent")],
      escalation: [answer("needs_reply")],
    });
    const lines: string[] = [];
    const cases = threeCases();
    await runEval(
      { ...deps(first.llm), onResult: async (result) => void lines.push(JSON.stringify(result)) },
      { ...base, cases, escalation }
    );
    expect(first.callsOf("escalation")).toHaveLength(1);

    // The state file is JSON lines: read it back through the same parser the CLI uses.
    const done = parseCaseResults(lines.join("\n"));
    const stored = done.find((c) => c.escalation != null);
    expect(stored?.id).toBe("person");
    expect(stored?.escalation?.first.finalCategory).toBe("spam");
    expect(stored?.escalationUsage?.model).toBe(ESCALATION_MODEL);

    const second = fakeLlm({ classifier: [answer("urgent")], escalation: [answer("urgent")] });
    const report = await runEval(deps(second.llm), { ...base, cases, escalation, done });
    expect(second.requests).toHaveLength(0);
    // Both answers are still in the report: the cascade in the main fields, the first answer in `escalation`.
    expect(report.escalation?.triggered).toBe(1);
    expect(report.escalation?.changed).toEqual({ "spam->needs_reply": 1 });
    expect(report.escalation?.cost.escalationUsd).toBeGreaterThan(0);
  });

  test("a result of an older state file (no escalation fields) parses as not escalated", () => {
    const line = JSON.stringify({
      id: "old",
      kind: "synthetic",
      expected: "info",
      modelCategory: "info",
      finalCategory: "info",
      confidence: 0.9,
      source: "llm",
      whitelisted: false,
      blocked: false,
      usage: { model: "m", tokensIn: 1, tokensOut: 1, latencyMs: 1 },
      errorCode: null,
      plannedTypes: [],
      injectionPassed: null,
    });
    const [result] = parseCaseResults(line);
    expect(result?.escalation).toBeNull();
    expect(result?.escalationUsage).toBeNull();
  });

  test("a run without --escalate has no escalation report and no escalation call", async () => {
    const fake = fakeLlm({ classifier: [answer("spam")], escalation: [answer("needs_reply")] });
    const report = await runEval(deps(fake.llm), { ...base, cases: [makeCase({ id: "p" })] });
    expect(report.escalation).toBeNull();
    expect(fake.callsOf("escalation")).toHaveLength(0);
    expect(renderEvalReport(report)).not.toContain("## Escalation");
  });

  test("the report has an Escalation section with the triggered share, changes, K, H and the cost split", async () => {
    const fake = fakeLlm({
      classifier: [answer("spam"), answer("notification"), answer("urgent")],
      escalation: [answer("needs_reply")],
    });
    const report = await runEval(deps(fake.llm), { ...base, cases: threeCases(), escalation });
    const text = renderEvalReport(report);
    expect(text).toContain("## Escalation");
    expect(text).toContain("Triggered: 1 of 3 answered cases (33.3%).");
    expect(text).toContain("Changed final answers: 1 (spam->needs_reply 1)");
    expect(text).toContain("| first | 2 | 0 | 1 | 1 | 1 |");
    expect(text).toContain("| cascade | 0 | 0 | 0 | 0 | 0 |");
    expect(text).toContain("- classifier: $0.000450 ($0.000150 per mail)");
    expect(text).toContain("- escalation: $0.001500 ($0.000500 per mail)");
    expect(text).toContain("- cascade: $0.001950 ($0.000650 per mail)");
    // No case id and no mail text in the section.
    expect(text.slice(text.indexOf("## Escalation"), text.indexOf("## Usage"))).not.toContain("person");
  });
});

describe("escalationSignalsOfCase", () => {
  test("reads the list, auto and precedence headers case-insensitively; noreply comes from the caller", () => {
    const c = makeCase({
      headers: { "list-id": "<x>", "AUTO-SUBMITTED": "auto-replied", precedence: "bulk" },
    });
    expect(escalationSignalsOfCase(c, { finalCategory: "spam", reasonCode: "other", noreply: true })).toEqual({
      finalCategory: "spam",
      reasonCode: "other",
      noreply: true,
      isList: true,
      autoSubmitted: "auto-replied",
      precedence: "bulk",
    });
  });

  test("a case without sim headers is a plain person mail", () => {
    expect(escalationSignalsOfCase(makeCase(), { finalCategory: "info", reasonCode: null, noreply: false })).toEqual({
      finalCategory: "info",
      reasonCode: null,
      noreply: false,
      isList: false,
      autoSubmitted: null,
      precedence: null,
    });
  });
});

describe("missesOf", () => {
  test("rule rows are not counted, like the confusion matrix", () => {
    expect(
      missesOf([{ expected: "urgent", predicted: "spam", modelCategory: "spam", confidence: 1, source: "rule" }])
    ).toMatchObject({ k: 0, h: 0 });
  });
});

describe("escalation-v1 prompt (stage 12 test 3)", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");

  test("its system and user text equal the base classifier prompt for a fixture", () => {
    const email = {
      from: "a@b.test",
      to: ["boss@firma.test"],
      cc: [],
      subject: "Hello",
      receivedAt: new Date("2026-11-15T10:00:00Z"),
      bodyText: "Body text",
      thread: [],
    };
    const sender = { whitelisted: false, vip: false, noreply: false };
    const allowed = ["urgent", "needs_reply", "info", "notification", "spam", "unsure"] as const;
    // The registry names the base; a move of the classifier pointer needs `escalation-v2`.
    expect(prompts.escalation.base).toBe(prompts.classifier.version);
    const base: ClassifierPrompt = classifierVersions[prompts.escalation.base];
    expect(sha(prompts.escalation.buildSystem(allowed))).toBe(sha(base.buildSystem(allowed, [])));
    expect(sha(prompts.escalation.buildUser(email, sender, [], "n".repeat(32)))).toBe(
      sha(base.buildUser(email, sender, [], "n".repeat(32), EMPTY_EXTRAS, []))
    );
  });
});
