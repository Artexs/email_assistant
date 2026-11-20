import { describe, expect, test } from "bun:test";

import type { Batch, BatchCase, PersonaFile } from "./batch";
import { applyBlindLabels, blindLabelsSchema, blindView } from "./blind";

const personas: PersonaFile = {
  inbox: { username: "ea-testmail", clientId: "ea-testmail-1", defaultDisplayName: "Test Inbox" },
  personas: [
    { key: "boss", displayName: "Anna Boss", group: "work", lang: "pl", voice: "boss" },
    { key: "peer", displayName: "Piotr Peer", group: "work", lang: "pl", voice: "peer" },
  ],
};

function makeCase(id: string, overrides: Partial<BatchCase> = {}): BatchCase {
  return {
    id,
    persona: "boss",
    lang: "pl",
    subject: `Temat ${id}`,
    body: `Tresc ${id}`,
    expected: { category: "info" },
    ...overrides,
  };
}

const batch: Batch = {
  batch: "2026-11-08-a",
  writer: "claude-sonnet-5-5",
  delegatesActive: false,
  cases: [
    makeCase("a", { note: "secret note" }),
    makeCase("b", { persona: "peer", replyTo: "a", blind: { category: "info" } }),
    makeCase("c", { replyTo: "b", expected: { category: "needs_reply" } }),
  ],
};

describe("blindView", () => {
  test("hides expected data and builds the thread, oldest first", () => {
    const view = blindView(batch, personas);
    const c = view.find((item) => item.id === "c");
    expect(c?.thread.map((t) => t.subject)).toEqual(["Temat a", "Temat b"]);
    expect(view[0]?.thread).toEqual([]);
    for (const item of view) {
      expect(Object.keys(item).sort()).toEqual(["body", "from", "id", "lang", "subject", "thread"]);
      expect(item.from).toBe("ea-testmail@agentmail.to");
      for (const t of item.thread) {
        expect(Object.keys(t).sort()).toEqual(["body", "from", "subject"]);
        expect(t.from).toBe("ea-testmail@agentmail.to");
      }
    }
    const json = JSON.stringify(view);
    expect(json).not.toContain("Anna Boss");
    expect(json).not.toContain("Piotr Peer");
    expect(json).not.toContain("secret note");
    expect(json).not.toContain("persona");
  });
});

describe("applyBlindLabels", () => {
  test("sets blind on labelled cases and reports unknown and missing ids", () => {
    const copy = structuredClone(batch);
    const result = applyBlindLabels(
      batch,
      [
        { id: "a", category: "spam" },
        { id: "c", category: "urgent" },
        { id: "zzz", category: "info" },
      ],
      "claude-opus-5-5"
    );
    expect(result.batch.checker).toBe("claude-opus-5-5");
    expect(result.batch.cases.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(result.batch.cases[0]?.blind).toEqual({ category: "spam" });
    expect(result.batch.cases[2]?.blind).toEqual({ category: "urgent" });
    expect(result.batch.cases[1]?.blind).toEqual({ category: "info" });
    expect(result.batch.cases[0]?.note).toBe("secret note");
    expect(result.missingIds).toEqual(["b"]);
    expect(result.unknownIds).toEqual(["zzz"]);
    expect(batch).toEqual(copy);
  });
});

describe("blindLabelsSchema", () => {
  test("accepts valid labels", () => {
    expect(blindLabelsSchema.safeParse([{ id: "a", category: "spam" }]).success).toBe(true);
  });
  test("accepts the delegation label", () => {
    expect(blindLabelsSchema.safeParse([{ id: "a", category: "delegation" }]).success).toBe(true);
  });
  test("refuses a duplicate id and an extra field", () => {
    expect(
      blindLabelsSchema.safeParse([
        { id: "a", category: "spam" },
        { id: "a", category: "info" },
      ]).success
    ).toBe(false);
    expect(blindLabelsSchema.safeParse([{ id: "a", category: "spam", extra: 1 }]).success).toBe(false);
  });
});

describe("blindView, exact output", () => {
  test("a reply to itself and a loop of replies stop at the first repeat", () => {
    const loop: Batch = {
      ...batch,
      cases: [makeCase("a", { replyTo: "a" }), makeCase("b", { replyTo: "c" }), makeCase("c", { replyTo: "b" })],
    };
    const view = blindView(loop, personas);
    expect(view.map((item) => item.thread.map((t) => t.subject))).toEqual([[], ["Temat c"], ["Temat b"]]);
  });

  test("a case that replies into a loop it is not part of lists each case of the loop once", () => {
    const loop: Batch = {
      ...batch,
      cases: [makeCase("a", { replyTo: "b" }), makeCase("b", { replyTo: "c" }), makeCase("c", { replyTo: "b" })],
    };
    expect(blindView(loop, personas)[0]?.thread.map((t) => t.subject)).toEqual(["Temat c", "Temat b"]);
  });
});

describe("blindLabelsSchema, exact issues", () => {
  test("a repeated id is an issue on each later label, at its own index", () => {
    const result = blindLabelsSchema.safeParse([
      { id: "a", category: "spam" },
      { id: "b", category: "info" },
      { id: "a", category: "info" },
      { id: "a", category: "urgent" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ code, path, message }) => ({ code, path, message }))).toEqual([
      { code: "custom", path: [2, "id"], message: "label id not unique" },
      { code: "custom", path: [3, "id"], message: "label id not unique" },
    ]);
  });
});
