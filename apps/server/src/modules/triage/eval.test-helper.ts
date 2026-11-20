import { delegateIdOf, type EvalCase, type LlmRole } from "@ea/core";

import { type LlmCall, type LlmClient, LlmSoftError, type LlmUsage } from "../../platform/llm";

export const usage: LlmUsage = {
  role: "classifier",
  promptVersion: "classifier-v2",
  model: "gemini-3.5-flash-lite",
  tokensIn: 100,
  tokensOut: 20,
  latencyMs: 50,
  endpoint: "standard",
  provider: "openai" as const,
};

export type Step = Record<string, unknown> | Error;

export interface Recorded {
  prompt: string;
  system: string;
}

export function answer(category: string, confidence = 0.9): Record<string, unknown> {
  return {
    category,
    confidence,
    reason_code: "other",
    reason: "Because.",
    summary: category === "info" ? "Short summary." : null,
    fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
  };
}

// Scripted answers by call order; the last step repeats.
export function fakeLlm(script: Step[] | ((c: Recorded, n: number) => Step)): { llm: LlmClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const llm: LlmClient = {
    modelOf: () => "gemini-3.5-flash-lite",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const n = calls.length;
      calls.push({ prompt: req.prompt, system: req.system });
      const step =
        typeof script === "function"
          ? script(calls[n] as Recorded, n)
          : (script[Math.min(n, script.length - 1)] as Step);
      if (step instanceof Error) throw step;
      return { data: step as T, usage };
    },
  };
  return { llm, calls };
}

export function makeCase(over: Partial<EvalCase> = {}): EvalCase {
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
    ...over,
  };
}

export const anna = { key: "anna", name: "Anna Nowak", tags: ["faktury"] };
export const marek = { key: "marek", name: "Marek Lis", tags: ["oferty"] };

export function delegationAnswer(fields: {
  delegate?: string | null;
  task?: string | null;
  clarification?: string | null;
}) {
  return {
    ...answer("delegation"),
    fields: {
      due_date: "2026-11-06",
      language: "en",
      delegate_id: fields.delegate === undefined || fields.delegate === null ? null : delegateIdOf(fields.delegate),
      task: fields.task ?? null,
      clarification: fields.clarification ?? null,
    },
  };
}

export function delegationCase(over: Partial<EvalCase> = {}): EvalCase {
  return makeCase({
    id: "d1",
    delegates: [anna, marek],
    expected: { category: "delegation", delegate: "anna", draft: "delegation" },
    ...over,
  });
}

export function harness() {
  const waits: number[] = [];
  return {
    waits,
    deps: (llm: LlmClient) => ({
      llm,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      now: () => new Date("2026-11-05T12:00:00Z"),
    }),
  };
}

export const opts = { model: "gemini-3.5-flash-lite", provider: "gemini" as const, bar: 0.98, minKept: 30, retries: 4 };
export const soft = () => new LlmSoftError("http_503", "m");

// A fake whose answer time and answer depend on the case: the subject of each case is its id.
export function delayedLlm(plan: (id: string, n: number) => { ms: number; step: Step }) {
  const started: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const llm: LlmClient = {
    modelOf: () => "gemini-3.5-flash-lite",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const id = /^Subject: (.*)$/m.exec(req.prompt)?.[1] ?? "?";
      const n = started.length;
      started.push(id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const { ms, step } = plan(id, n);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight -= 1;
      if (step instanceof Error) throw step;
      return { data: step as T, usage };
    },
  };
  return { llm, started, maxInFlight: () => maxInFlight };
}

export function idCases(count: number): EvalCase[] {
  return Array.from({ length: count }, (_, i) =>
    makeCase({ id: `c${String(i).padStart(2, "0")}`, subject: `c${String(i).padStart(2, "0")}` })
  );
}

export const fixedCost = (usd: number) => ({
  capUsd: 0,
  callCostUsd: () => usd,
  firstEstimateUsd: usd,
});
