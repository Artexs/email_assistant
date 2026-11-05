import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { evalCaseSchema, splitAddress } from "@ea/core";
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
});
