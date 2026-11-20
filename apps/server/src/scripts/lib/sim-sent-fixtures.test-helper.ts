import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { miniScenario, miniSentPlanSpec, sentExpectedOf, sentFixtureText, sentParts, type SentPart } from "@ea/core";

import { listBatches, writeJson } from "../../platform/sim-files";
import { readSentSlots } from "../../platform/sim-sent-files";

import { runSimInProcess } from "./sim-fixtures.test-helper";

// Test helper of the sent bank: a corpus folder in a temp dir, planned from miniScenario and miniSentPlanSpec.

export interface SentCorpus {
  // The folder that holds the corpus folder (the --root value).
  root: string;
  // The corpus folder `<root>/mini`.
  dir: string;
  cleanup(): void;
}

// The floors that the 20 dev and 60 holdout slots of the mini plan can meet.
export const miniSentFloors = ["--min-dev", "20", "--min-holdout", "60"];

// Every folder this helper makes; each test file calls `removeAllSentCorpora` in `afterAll` (see sim-fixtures.test-helper.ts).
const made = new Set<string>();
let template: Promise<SentCorpus> | undefined;

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "f116-sim-sent-"));
  made.add(root);
  return root;
}

function corpusAt(root: string): SentCorpus {
  return {
    root,
    dir: join(root, miniScenario.id),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      made.delete(root);
    },
  };
}

// Removes every folder this helper made in this test file.
export function removeAllSentCorpora(): void {
  for (const root of made) rmSync(root, { recursive: true, force: true });
  made.clear();
  template = undefined;
}

export async function createSentCorpus(options: { plan?: boolean } = {}): Promise<SentCorpus> {
  const root = makeRoot();
  const dir = join(root, miniScenario.id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "scenario.json"), miniScenario);
  writeJson(join(dir, "sent-plan-spec.json"), miniSentPlanSpec);
  if (options.plan === true) await run(["plan", miniScenario.id, "--bank", "sent", "--root", root]);
  return corpusAt(root);
}

export async function run(args: string[]): Promise<void> {
  const result = await runSimInProcess(args);
  if (result.code !== 0) throw new Error(`${args[0]} failed: ${result.stdout.trim().split("\n").join(" | ")}`);
}

export function writeSentTexts(c: SentCorpus, part: SentPart, batch: string, texts: unknown[]): void {
  writeJson(join(c.dir, part, "texts", `${batch}.json`), {
    scenario: miniScenario.id,
    part,
    batch,
    writer: "fixture",
    cases: texts,
  });
}

// A planned corpus with a clean text and an agreeing checker label for every case, so it can freeze.
async function writeComplete(c: SentCorpus): Promise<void> {
  for (const part of sentParts) {
    const slots = readSentSlots(c.dir, part);
    const batches = listBatches(c.dir, part, "slots");
    for (const batch of batches) {
      const own = slots.filter((slot) => slot.batch === batch);
      writeSentTexts(
        c,
        part,
        batch,
        own.map((slot) => sentFixtureText(slot))
      );
    }
    await run(["blind-export", miniScenario.id, "--part", part, "--batches", `1-${batches.length}`, "--root", c.root]);
    for (const batch of batches) {
      const labels = slots
        .filter((slot) => slot.batch === batch)
        .map((slot) => ({ id: slot.id, ...sentExpectedOf(slot, miniScenario.executive.timeZone) }));
      const file = join(c.root, `labels-${part}-${batch}.json`);
      writeFileSync(file, JSON.stringify(labels));
      const n = String(Number(batch.slice("batch-".length)));
      await run([
        "label-import",
        miniScenario.id,
        "--part",
        part,
        "--batch",
        n,
        "--checker",
        "fixture",
        "--file",
        file,
        "--root",
        c.root,
      ]);
    }
  }
}

// A copy of the complete corpus: it is built once per test file, then copied.
export async function completeSentCorpus(): Promise<SentCorpus> {
  if (template === undefined) {
    template = createSentCorpus({ plan: true }).then(async (c) => {
      await writeComplete(c);
      return c;
    });
  }
  const source = await template;
  const root = makeRoot();
  cpSync(source.root, root, { recursive: true });
  return corpusAt(root);
}
