import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyHardRules,
  EVAL_RECEIVED_AT,
  evalCaseSchema,
  miniScenario,
  selectCases,
  slotSchema,
  splitAddress,
  toEvalCase,
  type EvalCase,
} from "@ea/core";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { bodyTextFromSource, renderSeedMessage } from "../mail";

import { toClassifierInput } from "./eval";

const casesDir = resolve(import.meta.dir, "../../../../../evals/cases");
const reservedDomains = ["example.com", "example.org", "example.net"];

function load(file: string) {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

const synthetic = load("synthetic.json");
const injection = load("injection.json");
const delegation = load("delegation.json");
const all = [...synthetic, ...injection];
const everything = [...all, ...delegation];

// The made-up delegate pool of evals/README.md. A case may use only these entries.
const delegatePool: Record<string, { name: string; tags: string[] }> = {
  anna: { name: "Anna Nowak", tags: ["faktury", "księgowość"] },
  marek: { name: "Marek Lis", tags: ["oferty", "sprzedaż"] },
  ola: { name: "Ola Bąk", tags: ["hr", "rekrutacja"] },
};

function trustedCases(cases: EvalCase[]): EvalCase[] {
  return cases.filter((c) => c.senderRules.some((r) => r.kind === "whitelist" || r.kind === "vip"));
}

function expectRuleMatches(evalCase: EvalCase) {
  const result = applyHardRules(splitAddress(evalCase.from).address, evalCase.senderRules);
  expect(result.kind).toBe("classify");
  if (result.kind !== "classify") return;
  expect(result.whitelisted).toBe(true);
  expect(result.allowed).not.toContain("spam");
  expect(evalCase.expected.category).not.toBe("spam");
}

function isReservedDomain(domain: string): boolean {
  return domain === "test" || domain.endsWith(".test") || reservedDomains.some((d) => domain === d);
}

describe("eval case files", () => {
  test("ids are unique across files", () => {
    const ids = everything.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each file holds its own kind", () => {
    expect(synthetic.every((c) => c.kind === "synthetic")).toBe(true);
    expect(injection.every((c) => c.kind === "injection")).toBe(true);
    expect(delegation.every((c) => c.kind === "synthetic")).toBe(true);
  });

  test("every address is ASCII and uses a reserved domain", () => {
    for (const evalCase of everything) {
      const values = [evalCase.from, ...evalCase.to, ...evalCase.cc, ...evalCase.thread.map((message) => message.from)];
      for (const value of values) {
        const { address } = splitAddress(value);
        expect(address).toContain("@");
        expect(address).toMatch(/^[\x21-\x7e]+$/);
        const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
        expect(isReservedDomain(domain)).toBe(true);
      }
    }
  });

  test("every sender rule pattern is lower case", () => {
    for (const evalCase of everything) {
      for (const rule of evalCase.senderRules) expect(rule.pattern).toBe(rule.pattern.toLowerCase());
    }
  });

  describe("urgent and needs_reply coverage", () => {
    const urgent = synthetic.filter((c) => c.expected.category === "urgent");
    const needsReply = synthetic.filter((c) => c.expected.category === "needs_reply");
    const both = [...urgent, ...needsReply];

    test("each category has at least 15 cases", () => {
      expect(urgent.length).toBeGreaterThanOrEqual(15);
      expect(needsReply.length).toBeGreaterThanOrEqual(15);
    });

    test("at least half of the cases are Polish", () => {
      expect(both.filter((c) => c.lang === "pl").length).toBeGreaterThanOrEqual(both.length / 2);
    });

    test("each category has at least 3 borderline cases", () => {
      for (const group of [urgent, needsReply]) {
        expect(group.filter((c) => c.note?.startsWith("borderline:")).length).toBeGreaterThanOrEqual(3);
      }
    });

    test("at least 4 whitelist or vip cases are not spam", () => {
      const trusted = trustedCases(both);
      expect(trusted.length).toBeGreaterThanOrEqual(4);
      for (const evalCase of trusted) expectRuleMatches(evalCase);
    });

    test("at least 3 cases have thread entries", () => {
      expect(both.filter((c) => c.thread.length > 0).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("info and notification coverage", () => {
    const info = synthetic.filter((c) => c.expected.category === "info");
    const notification = synthetic.filter((c) => c.expected.category === "notification");
    const both = [...info, ...notification];

    test("each category has at least 15 cases", () => {
      expect(info.length).toBeGreaterThanOrEqual(15);
      expect(notification.length).toBeGreaterThanOrEqual(15);
    });

    test("at least half of the cases are Polish", () => {
      expect(both.filter((c) => c.lang === "pl").length).toBeGreaterThanOrEqual(both.length / 2);
    });

    test("each category has at least 3 borderline cases", () => {
      for (const group of [info, notification]) {
        expect(group.filter((c) => c.note?.startsWith("borderline:")).length).toBeGreaterThanOrEqual(3);
      }
    });

    test("at least 6 whitelist or vip cases are not spam", () => {
      const trusted = trustedCases(both);
      expect(trusted.length).toBeGreaterThanOrEqual(6);
      for (const evalCase of trusted) expectRuleMatches(evalCase);
    });
  });

  describe("spam, blocklist and injection coverage", () => {
    const spam = synthetic.filter((c) => c.expected.category === "spam");
    const blocklisted = spam.filter((c) => c.senderRules.some((r) => r.kind === "blocklist"));

    test("spam has at least 15 cases, at least half Polish, at least 3 borderline", () => {
      expect(spam.length).toBeGreaterThanOrEqual(15);
      expect(spam.filter((c) => c.lang === "pl").length).toBeGreaterThanOrEqual(spam.length / 2);
      expect(spam.filter((c) => c.note?.startsWith("borderline:")).length).toBeGreaterThanOrEqual(3);
    });

    test("at least 3 blocklist cases match their sender and give spam", () => {
      expect(blocklisted.length).toBeGreaterThanOrEqual(3);
      for (const evalCase of blocklisted) {
        const result = applyHardRules(splitAddress(evalCase.from).address, evalCase.senderRules);
        expect(result).toEqual({ kind: "spam", reasonCode: "blocklist" });
      }
    });

    test("at least 10 whitelist or vip cases in the whole file are not spam", () => {
      const trusted = trustedCases(all);
      expect(trusted.length).toBeGreaterThanOrEqual(10);
      for (const evalCase of trusted) expectRuleMatches(evalCase);
    });

    test("at least half of all synthetic cases are Polish", () => {
      expect(synthetic.filter((c) => c.lang === "pl").length).toBeGreaterThanOrEqual(synthetic.length / 2);
    });

    test("injection has at least 12 cases, 4 Polish, 4 English, each with an attack note", () => {
      expect(injection.length).toBeGreaterThanOrEqual(12);
      expect(injection.filter((c) => c.lang === "pl").length).toBeGreaterThanOrEqual(4);
      expect(injection.filter((c) => c.lang === "en").length).toBeGreaterThanOrEqual(4);
      for (const evalCase of injection) expect(evalCase.note?.startsWith("attack:")).toBe(true);
    });

    test("subset sizes are exact", () => {
      const subset = selectCases(all, { perCategory: 3 });
      expect(subset).toHaveLength(18);
      expect(trustedCases(subset).length).toBeGreaterThanOrEqual(1);
      expect(subset.filter((c) => c.senderRules.some((r) => r.kind === "blocklist")).length).toBeGreaterThanOrEqual(1);
      expect(selectCases(synthetic, { perCategory: 4 })).toHaveLength(20);
    });
  });

  describe("delegation coverage", () => {
    const withDelegates = [...delegation, ...injection.filter((c) => c.delegates.length > 0)];

    test("every expected delegate is a key of the case's delegates, and keys are unique per case", () => {
      for (const evalCase of withDelegates) {
        const keys = evalCase.delegates.map((d) => d.key);
        expect(new Set(keys).size).toBe(keys.length);
        if (evalCase.expected.delegate !== undefined) expect(keys).toContain(evalCase.expected.delegate);
      }
    });

    test("delegation cases have 2 or 3 delegates and expect the category delegation", () => {
      for (const evalCase of delegation) {
        expect(evalCase.expected.category).toBe("delegation");
        expect(evalCase.delegates.length).toBeGreaterThanOrEqual(2);
        expect(evalCase.delegates.length).toBeLessThanOrEqual(3);
      }
    });

    test("12 delegation cases: 6 Polish, 6 English, 8 with a delegate, 4 that need a question", () => {
      expect(delegation).toHaveLength(12);
      expect(delegation.filter((c) => c.lang === "pl")).toHaveLength(6);
      expect(delegation.filter((c) => c.lang === "en")).toHaveLength(6);
      expect(delegation.filter((c) => c.expected.draft === "delegation" && c.expected.delegate)).toHaveLength(8);
      expect(delegation.filter((c) => c.expected.draft === "clarification")).toHaveLength(4);
    });

    test("delegates come from the made-up pool", () => {
      for (const evalCase of withDelegates) {
        for (const delegate of evalCase.delegates) {
          expect(delegatePool[delegate.key]).toEqual({ name: delegate.name, tags: delegate.tags });
        }
      }
    });

    test("injection cases inj-13 to inj-16 have delegates, expect spam and no draft", () => {
      for (const id of ["inj-13", "inj-14", "inj-15", "inj-16"]) {
        const evalCase = injection.find((c) => c.id === id);
        expect(evalCase).toBeDefined();
        expect(evalCase?.delegates.length).toBeGreaterThan(0);
        expect(evalCase?.expected).toEqual({ category: "spam", draft: "none" });
        expect(evalCase?.note?.startsWith("attack:")).toBe(true);
      }
    });

    test("case texts never hold a delegate id", () => {
      for (const evalCase of withDelegates) {
        const text = [evalCase.subject, evalCase.body, ...evalCase.thread.map((m) => m.body)].join("\n");
        expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      }
    });

    test("a delegation case is allowed the category delegation", () => {
      for (const evalCase of delegation) {
        const result = applyHardRules(splitAddress(evalCase.from).address, evalCase.senderRules, { delegation: true });
        expect(result.kind).toBe("classify");
        if (result.kind === "classify") expect(result.allowed).toContain("delegation");
      }
    });
  });
});

// The classifier input before the stage that added receivedAt to cases: the pin for the old cases.
function oldClassifierInput(c: EvalCase) {
  const n = c.thread.length;
  return {
    from: splitAddress(c.from).address,
    to: c.to.map((value) => splitAddress(value).address),
    cc: c.cc.map((value) => splitAddress(value).address),
    subject: c.subject,
    receivedAt: EVAL_RECEIVED_AT,
    bodyText: c.body,
    thread: c.thread.map((t, i) => ({
      from: splitAddress(t.from).address,
      subject: t.subject,
      receivedAt: new Date(EVAL_RECEIVED_AT.getTime() - (n - i) * 3_600_000),
      bodyExcerpt: t.body.slice(0, 500),
    })),
  };
}

describe("old eval cases", () => {
  test("1 every case file parses and keeps its classifier input", () => {
    const files = readdirSync(casesDir).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    let count = 0;
    for (const file of files) {
      for (const c of load(file)) {
        expect(toClassifierInput(c)).toEqual(oldClassifierInput(c));
        count += 1;
      }
    }
    expect(count).toBe(everything.length);
  });
});

describe("html text like the pipeline", () => {
  test("7 an html-only text joins to the body that the IMAP mapper reads", async () => {
    const slot = slotSchema.parse({
      id: "h-html-01",
      part: "dev",
      batch: "batch-001",
      persona: "kasia",
      to: ["szef"],
      lang: "pl",
      receivedAt: "2026-11-02T09:00:00.000Z",
      category: "info",
      kind: "synthetic",
      hardCases: ["html_only"],
      style: { length: "short", format: "html", signature: false, greeting: "none" },
      brief: "an html-only mail",
    });
    const result = await toEvalCase(
      {
        slot,
        text: { id: slot.id, subject: "Raport", body: "", html: "<p>Dzień <b>dobry</b></p>", thread: [] },
        scenario: miniScenario,
        corpusVersion: "v1",
      },
      {
        htmlBodyText: (input) =>
          bodyTextFromSource(
            Buffer.from(
              renderSeedMessage({
                from: input.from,
                to: input.to,
                subject: input.subject,
                date: input.date,
                html: input.html,
              })
            )
          ),
      }
    );
    expect(result.body).toContain("Dzień dobry");
  });
});
