import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { otherAddressOf } from "@ea/core";
import { afterEach, describe, expect, test } from "bun:test";

import { LAB_MAILBOXES, labAddresses, loadLabCorpus } from "./corpus";

const ROOT = resolve(import.meta.dir, "../../../../../evals/sim");

describe("lab corpus", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("6: lab-01 holds 855 slots and 855 texts; parentsOf gives the chain, root first", async () => {
    const corpus = await loadLabCorpus(ROOT, "lab-01");
    expect(corpus.slots.size).toBe(855);
    expect(corpus.texts.size).toBe(855);
    expect(corpus.scenario.id).toBe("lab-01");
    const depthOf = (id: string): number => corpus.parentsOf(id).length;
    const deep = [...corpus.slots.values()].find((slot) => depthOf(slot.id) === 2);
    if (deep === undefined) throw new Error("no depth-2 reply in the corpus");
    const chain = corpus.parentsOf(deep.id);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.parentId).toBeUndefined();
    expect(chain[1]?.parentId).toBe(chain[0]?.id);
    expect(deep.parentId).toBe(chain[1]?.id);
    const root = [...corpus.slots.values()].find((slot) => slot.parentId === undefined);
    expect(corpus.parentsOf(root?.id ?? "")).toEqual([]);
  });

  test("labAddresses holds the persona, executive and mailbox addresses", async () => {
    const corpus = await loadLabCorpus(ROOT, "lab-01");
    const addresses = labAddresses(corpus);
    for (const persona of corpus.scenario.personas) expect(addresses).toContain(persona.address.toLowerCase());
    expect(addresses).toContain(LAB_MAILBOXES.lab);
    expect(addresses).toContain(LAB_MAILBOXES.demo);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  test("labAddresses holds the other_address alias of each delegate and of no other persona", async () => {
    const corpus = await loadLabCorpus(ROOT, "lab-01");
    const addresses = labAddresses(corpus);
    const delegates = corpus.scenario.personas.filter((persona) => persona.group === "delegate");
    expect(delegates.length).toBeGreaterThan(0);
    for (const persona of delegates) expect(addresses).toContain(otherAddressOf(persona.address));
    expect(addresses).toContain("dorota.wilczynska@poczta-prywatna.test");
    expect(addresses.filter((address) => address.endsWith("@poczta-prywatna.test"))).toHaveLength(delegates.length);
  });

  test("7: the loader never reads holdout/ or dev/", async () => {
    // A copy of the corpus whose holdout/ and dev/ hold files that fail on any read: invalid JSON in every batch folder.
    const dir = mkdtempSync(join(tmpdir(), "f113-s04-corpus-"));
    dirs.push(dir);
    const copy = join(dir, "lab-01");
    mkdirSync(copy);
    for (const file of ["scenario.json", "manifest.json"]) cpSync(join(ROOT, "lab-01", file), join(copy, file));
    symlinkSync(join(ROOT, "lab-01", "week"), join(copy, "week"));
    for (const part of ["holdout", "dev"]) {
      for (const folder of ["slots", "texts", "blind", "labels"]) {
        mkdirSync(join(copy, part, folder), { recursive: true });
        writeFileSync(join(copy, part, folder, "batch-001.json"), "{ not json");
      }
      writeFileSync(join(copy, part, "poison.json"), "{ not json");
    }
    const corpus = await loadLabCorpus(dir, "lab-01");
    expect(corpus.slots.size).toBe(855);
  });
});
