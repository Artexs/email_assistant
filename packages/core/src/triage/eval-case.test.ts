import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { Category } from "./categories";
import { delegateIdOf, evalCaseSchema, selectCases, type EvalCase } from "./eval-case";
import type { SenderRuleKind } from "./rules";

function makeCase(
  id: string,
  category: Exclude<Category, "unsure">,
  options: { kind?: EvalCase["kind"]; rule?: SenderRuleKind } = {}
): EvalCase {
  return evalCaseSchema.parse({
    id,
    kind: options.kind ?? "synthetic",
    lang: "en",
    from: "a@example.com",
    to: ["szef@firma.test"],
    subject: "s",
    body: "b",
    senderRules: options.rule ? [{ pattern: "example.com", kind: options.rule }] : [],
    expected: { category },
  });
}

const categories = ["urgent", "needs_reply", "info", "notification", "spam", "delegation"] as const;

function buildList(): EvalCase[] {
  const list: EvalCase[] = [];
  for (const category of categories) {
    for (const index of [1, 2, 3, 4]) list.push(makeCase(`${category}-${index}`.replace("_", "-"), category));
  }
  for (const index of [1, 2, 3, 4]) list.push(makeCase(`inj-${index}`, "spam", { kind: "injection" }));
  return list;
}

describe("selectCases", () => {
  test("gives n per synthetic category and n injection cases", () => {
    const result = selectCases(buildList(), { perCategory: 2 });
    for (const category of categories) {
      expect(result.filter((c) => c.kind === "synthetic" && c.expected.category === category)).toHaveLength(2);
    }
    expect(result.filter((c) => c.kind === "injection").map((c) => c.id)).toEqual(["inj-1", "inj-2"]);
  });

  test("is stable across calls and shuffled input", () => {
    const list = buildList();
    const shuffled = [...list].reverse();
    const first = selectCases(list, { perCategory: 2 }).map((c) => c.id);
    expect(selectCases(list, { perCategory: 2 }).map((c) => c.id)).toEqual(first);
    expect(selectCases(shuffled, { perCategory: 2 }).map((c) => c.id)).toEqual(first);
  });

  test("returns all cases sorted by id without perCategory", () => {
    const list = buildList();
    const result = selectCases([...list].reverse(), {});
    expect(result).toHaveLength(list.length);
    expect(result.map((c) => c.id)).toEqual(list.map((c) => c.id).sort());
  });

  test("picks sender rule cases first", () => {
    const list = [
      makeCase("a-plain", "info"),
      makeCase("b-plain", "info"),
      makeCase("y-block", "info", { rule: "blocklist" }),
      makeCase("z-white", "info", { rule: "whitelist" }),
    ];
    const ids = (n: number) => selectCases(list, { perCategory: n }).map((c) => c.id);
    expect(ids(1)).toEqual(["z-white"]);
    expect(ids(2)).toEqual(["y-block", "z-white"]);
    expect(ids(3)).toEqual(["a-plain", "y-block", "z-white"]);
  });

  test("a vip rule counts as a whitelist case", () => {
    const list = [makeCase("a-plain", "info"), makeCase("b-vip", "info", { rule: "vip" })];
    expect(selectCases(list, { perCategory: 1 }).map((c) => c.id)).toEqual(["b-vip"]);
  });

  test("a category without rule cases gives the first n by id", () => {
    const list = [makeCase("c-3", "spam"), makeCase("c-1", "spam"), makeCase("c-2", "spam")];
    expect(selectCases(list, { perCategory: 2 }).map((c) => c.id)).toEqual(["c-1", "c-2"]);
  });
});

describe("selectCases with delegation cases", () => {
  test("gives n delegation synthetic cases and still the injection subset", () => {
    const result = selectCases(buildList(), { perCategory: 2 });
    expect(result.filter((c) => c.kind === "synthetic" && c.expected.category === "delegation")).toHaveLength(2);
    expect(result.filter((c) => c.kind === "injection")).toHaveLength(2);
    expect(result).toHaveLength(14);
  });
});

describe("delegateIdOf", () => {
  test("is a deterministic uuid per key", () => {
    const id = delegateIdOf("anna");
    expect(id).toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
    expect(z.string().uuid().safeParse(id).success).toBe(true);
    expect(delegateIdOf("anna")).toBe(id);
    expect(delegateIdOf("marek")).not.toBe(id);
  });

  test("uses the first 12 hex characters of sha256(key)", () => {
    const hash = createHash("sha256").update("anna").digest("hex");
    expect(delegateIdOf("anna")).toBe(`00000000-0000-4000-8000-${hash.slice(0, 12)}`);
  });
});

describe("evalCaseSchema", () => {
  const valid = {
    id: "case-1",
    kind: "synthetic",
    lang: "pl",
    from: "a@example.com",
    to: ["szef@firma.test"],
    subject: "s",
    body: "b",
    expected: { category: "info" },
  };

  test("accepts a valid case and fills defaults", () => {
    const parsed = evalCaseSchema.parse(valid);
    expect(parsed.cc).toEqual([]);
    expect(parsed.thread).toEqual([]);
    expect(parsed.senderRules).toEqual([]);
    expect(parsed.delegates).toEqual([]);
    expect(parsed.expected.delegate).toBeUndefined();
    expect(parsed.expected.draft).toBeUndefined();
  });

  test("parses delegates with default tags and the expected delegate and draft", () => {
    const parsed = evalCaseSchema.parse({
      ...valid,
      delegates: [
        { key: "anna", name: "Anna Nowak" },
        { key: "marek", name: "Marek Lis", tags: ["oferty"] },
      ],
      expected: { category: "delegation", delegate: "anna", draft: "clarification" },
    });
    expect(parsed.delegates).toEqual([
      { key: "anna", name: "Anna Nowak", tags: [] },
      { key: "marek", name: "Marek Lis", tags: ["oferty"] },
    ]);
    expect(parsed.expected).toEqual({ category: "delegation", delegate: "anna", draft: "clarification" });
  });

  test("rejects a bad delegate key, an empty name and an unknown draft kind", () => {
    const withDelegate = (delegate: unknown) => evalCaseSchema.safeParse({ ...valid, delegates: [delegate] });
    expect(withDelegate({ key: "Anna", name: "A" }).success).toBe(false);
    expect(withDelegate({ key: "anna", name: "" }).success).toBe(false);
    expect(
      evalCaseSchema.safeParse({ ...valid, expected: { category: "delegation", draft: "reminder" } }).success
    ).toBe(false);
  });

  test("rejects an upper-case id", () => {
    expect(evalCaseSchema.safeParse({ ...valid, id: "Case-1" }).success).toBe(false);
  });

  test("rejects an unknown category", () => {
    expect(evalCaseSchema.safeParse({ ...valid, expected: { category: "unsure" } }).success).toBe(false);
  });

  test("rejects an empty to list", () => {
    expect(evalCaseSchema.safeParse({ ...valid, to: [] }).success).toBe(false);
  });
});
