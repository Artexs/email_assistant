import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "bun:test";

import { gateFileSchema, prompts } from "./index";

// A prompt or model change of the classifier needs a sim holdout gate file (PD-025). CI has no LLM key, so it checks the evidence, not the numbers.
test("a sim holdout gate file exists for the current classifier prompt version", () => {
  const dir = resolve(import.meta.dir, "../../../../../evals/results/gate");
  const files = readdirSync(dir).filter(
    (file) => file.startsWith(`classifier-${prompts.classifier.version}-`) && file.endsWith(".json")
  );
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) gateFileSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
});
