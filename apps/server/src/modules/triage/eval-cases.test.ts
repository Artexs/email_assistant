import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { applyHardRules, evalCaseSchema, splitAddress, type EvalCase } from "@ea/core";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

const casesDir = resolve(import.meta.dir, "../../../../../evals/cases");
const reservedDomains = ["example.com", "example.org", "example.net"];

function load(file: string) {
  return z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(casesDir, file), "utf8")));
}

const synthetic = load("synthetic.json");
const injection = load("injection.json");
const all = [...synthetic, ...injection];

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
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each file holds its own kind", () => {
    expect(synthetic.every((c) => c.kind === "synthetic")).toBe(true);
    expect(injection.every((c) => c.kind === "injection")).toBe(true);
  });

  test("every address is ASCII and uses a reserved domain", () => {
    for (const evalCase of all) {
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
    for (const evalCase of all) {
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
});
