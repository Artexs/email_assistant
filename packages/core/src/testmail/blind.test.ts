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
