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

describe("selectCases priority inside one category", () => {
  const withRules = (id: string, kinds: SenderRuleKind[], from = "a@example.com"): EvalCase =>
    evalCaseSchema.parse({
      id,
      kind: "synthetic",
      lang: "en",
      from,
      to: ["szef@firma.test"],
      subject: "s",
      body: "b",
      senderRules: kinds.map((kind) => ({ pattern: "example.com", kind })),
      expected: { category: "info" },
    });
  // Input in reverse id order: the priority is by id, not by the order of the list.
  const list = [
    withRules("g-none", []),
    withRules("f-none", []),
    withRules("e-block", ["blocklist"]),
    withRules("d-white", ["whitelist"]),
    withRules("c-block", ["blocklist"]),
    withRules("b-both", ["blocklist", "whitelist"]),
    withRules("a-vip", ["vip"]),
  ];
  const picked = (cases: EvalCase[], n: number) => selectCases(cases, { perCategory: n }).map((c) => c.id);

  test.each([
    [1, ["a-vip"]],
    [2, ["a-vip", "c-block"]],
    [3, ["a-vip", "c-block", "f-none"]],
    [4, ["a-vip", "c-block", "f-none", "g-none"]],
    [5, ["a-vip", "b-both", "c-block", "f-none", "g-none"]],
    [6, ["a-vip", "b-both", "c-block", "d-white", "f-none", "g-none"]],
    [7, ["a-vip", "b-both", "c-block", "d-white", "e-block", "f-none", "g-none"]],
  ])(
    "takes the first %i cases by priority: first rule case, first block-only case, no-rule cases, the rest",
    (n, ids) => {
      expect(picked(list, n)).toEqual(ids);
    }
  );

  test("a block-only case is not chosen when it also has a whitelist rule", () => {
    expect(picked([withRules("b-both", ["blocklist", "whitelist"]), withRules("c-block", ["blocklist"])], 2)).toEqual([
      "b-both",
      "c-block",
    ]);
    expect(
      picked(
        [
          withRules("a-white", ["whitelist"]),
          withRules("b-both", ["blocklist", "whitelist"]),
          withRules("c-block", ["blocklist"]),
        ],
        2
      )
    ).toEqual(["a-white", "c-block"]);
  });

  test("without a whitelist case the first block-only case comes first", () => {
    const cases = [withRules("a-none", []), withRules("b-block", ["blocklist"]), withRules("c-block", ["blocklist"])];
    expect(picked(cases, 1)).toEqual(["b-block"]);
    expect(picked(cases, 2)).toEqual(["a-none", "b-block"]);
  });

  test("without a block-only case a whitelist case comes first and the no-rule cases follow", () => {
    const cases = [withRules("a-none", []), withRules("b-white", ["whitelist"]), withRules("c-white", ["whitelist"])];
    expect(picked(cases, 2)).toEqual(["a-none", "b-white"]);
    expect(picked(cases, 3)).toEqual(["a-none", "b-white", "c-white"]);
  });

  test("with no rule case the no-rule cases are the first n by id", () => {
    expect(picked([withRules("b", []), withRules("a", [])], 1)).toEqual(["a"]);
  });
});

describe("selectCases order by id", () => {
  test("sorts by the text of the id, not by number", () => {
    const cases = ["a2", "a10", "a1", "b1"].map((id) => makeCase(id, "info"));
    expect(selectCases(cases, {}).map((c) => c.id)).toEqual(["a1", "a10", "a2", "b1"]);
  });

  test("cases with the same id keep their input order", () => {
    const first = { ...makeCase("dup", "info"), subject: "first" };
    const second = { ...makeCase("dup", "info"), subject: "second" };
    expect(selectCases([first, second], {}).map((c) => c.subject)).toEqual(["first", "second"]);
    expect(selectCases([second, first], {}).map((c) => c.subject)).toEqual(["second", "first"]);
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
