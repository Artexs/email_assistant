import { join } from "node:path";

import { type CaseText, evalCaseSchema, type SimPart } from "@ea/core";
import { afterEach, describe, expect, test } from "bun:test";

import { HOLDOUT_NEEDS_FREEZE, loadSimCases } from "./eval-sim-load";
import { readSlots, writeJson, writeSlots } from "./sim-files";
import { createMiniCorpus, fixtureText, type MiniCorpus } from "./sim-fixtures.test-helper";

let corpus: MiniCorpus | undefined;
afterEach(() => {
  corpus?.cleanup();
  corpus = undefined;
});

// A planned corpus with a clean text for every slot of the part.
async function written(part: SimPart, edit: (text: CaseText) => CaseText = (text) => text): Promise<MiniCorpus> {
  corpus = await createMiniCorpus({ plan: true });
  const slots = readSlots(corpus.dir, part);
  for (const batch of new Set(slots.map((slot) => slot.batch))) {
    writeJson(join(corpus.dir, part, "texts", `${batch}.json`), {
      scenario: "mini",
      part,
      batch,
      writer: "fixture",
      cases: slots.filter((slot) => slot.batch === batch).map((slot) => edit(fixtureText(slot))),
    });
  }
  return corpus;
}

const load = (c: MiniCorpus, part: SimPart, requireManifest = false) =>
  loadSimCases({ root: c.root, scenario: "mini", part, requireManifest });

describe("loadSimCases", () => {
  test("dev: one case per written, not dropped text, in sorted id order", async () => {
    const c = await written("dev");
    const slots = readSlots(c.dir, "dev");
    const dropped = (slots[3] as { id: string }).id;
    const batch = (slots[3] as { batch: string }).batch;
    writeJson(join(c.dir, "dev", "texts", `${batch}.json`), {
      scenario: "mini",
      part: "dev",
      batch,
      writer: "fixture",
      cases: slots
        .filter((slot) => slot.batch === batch)
        .map((slot) => ({ ...fixtureText(slot), ...(slot.id === dropped ? { dropped: true as const } : {}) })),
    });
    const loaded = await load(c, "dev");
    const ids = loaded.cases.map((item) => item.id);
    expect(ids).toEqual(
      slots
        .map((slot) => slot.id)
        .filter((id) => id !== dropped)
        .sort()
    );
    expect(loaded.skipped).toEqual({ dropped: 1, unwritten: 0, sent: 0 });
    for (const item of loaded.cases) {
      expect(evalCaseSchema.safeParse(item).success).toBe(true);
      expect(item.sim?.part).toBe("dev");
    }
    expect(loaded).toMatchObject({ version: "draft", manifestSha: null, audit: "not frozen" });
  });

  test("holdout without a manifest throws; with one it loads and reports the version and audit", async () => {
    const c = await written("holdout");
    await expect(load(c, "holdout", true)).rejects.toThrow(HOLDOUT_NEEDS_FREEZE);
    expect(HOLDOUT_NEEDS_FREEZE).toBe("holdout needs a frozen corpus: run sim freeze");
    writeJson(join(c.dir, "manifest.json"), { version: "1", audit: { status: "pending" } });
    const loaded = await load(c, "holdout", true);
    expect(loaded.cases.length).toBe(readSlots(c.dir, "holdout").length);
    expect(loaded).toMatchObject({ version: "1", audit: "pending" });
    expect(loaded.manifestSha).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.cases[0]?.sim?.version).toBe("1");
  });

  test("week: a sent slot is no case; a reply holds its parent chain in thread", async () => {
    const c = await written("week");
    const slots = readSlots(c.dir, "week");
    const loaded = await load(c, "week");
    const sent = slots.filter((slot) => slot.direction === "sent");
    expect(sent.length).toBeGreaterThan(0);
    const ids = new Set(loaded.cases.map((item) => item.id));
    for (const slot of sent) expect(ids.has(slot.id)).toBe(false);
    expect(loaded.skipped.sent).toBe(sent.length);

    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    const reply = slots.find(
      (slot) =>
        slot.direction === "in" && slot.parentId !== undefined && byId.get(slot.parentId)?.parentId === undefined
    );
    expect(reply).toBeDefined();
    const item = loaded.cases.find((candidate) => candidate.id === reply?.id);
    expect(item?.thread[0]?.subject).toBe(`Temat ${reply?.parentId}`);
    expect(item?.thread).toHaveLength(1);
  });

  test("a deep thread keeps the 3 nearest parents, oldest first", async () => {
    const c = await written("week");
    const slots = readSlots(c.dir, "week");
    // Link 5 incoming slots into one chain: s0 <- s1 <- s2 <- s3 <- s4.
    const chain = slots.filter((slot) => slot.direction === "in" && slot.parentId === undefined).slice(0, 5);
    expect(chain).toHaveLength(5);
    const linked = slots.map((slot) => {
      const at = chain.findIndex((link) => link.id === slot.id);
      const parent = at > 0 ? chain[at - 1] : undefined;
      return parent === undefined ? slot : { ...slot, parentId: parent.id };
    });
    writeSlots(c.dir, "week", linked);
    const item = (await load(c, "week")).cases.find((candidate) => candidate.id === chain[4]?.id);
    expect(item?.thread.map((turn) => turn.subject)).toEqual(
      [chain[1], chain[2], chain[3]].map((link) => `Temat ${link?.id}`)
    );
  });

  test("an html-only slot gets the text of its html through the IMAP mapper", async () => {
    const c = await written("dev");
    const slot = readSlots(c.dir, "dev").find((candidate) => candidate.hardCases.includes("html_only"));
    expect(slot).toBeDefined();
    const loaded = await load(c, "dev");
    const item = loaded.cases.find((candidate) => candidate.id === slot?.id);
    expect(item?.body).toContain(`Sprawa ${slot?.id}`);
    expect(item?.body).not.toContain("<p>");
  });
});
