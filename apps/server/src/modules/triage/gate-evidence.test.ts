import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, spyOn, test } from "bun:test";

import { globalEvidenceFor, loadGateEvidence } from "./evidence";

import { gateFileSchema, prompts } from "./index";

// An `-eu` or `-own` gate file proves another endpoint (F111 D8). It still has to parse, but it is no evidence for
// the default endpoint of the install, so it does not count here.
const ENDPOINT_SUFFIX = /-(eu|own)\.json$/;

// Every gate file of the prompt version is parsed. The result lists the files that count as PD-025 evidence:
// no endpoint suffix in the name, and no other endpoint in the file.
function gateEvidence(dir: string, promptVersion: string): string[] {
  const files = readdirSync(dir).filter(
    (file) => file.startsWith(`classifier-${promptVersion}-`) && file.endsWith(".json")
  );
  const evidence: string[] = [];
  for (const file of files) {
    const parsed = gateFileSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    if (!ENDPOINT_SUFFIX.test(file) && parsed.endpoint === "standard") evidence.push(file);
  }
  return evidence;
}

// A prompt or model change of the classifier needs a sim holdout gate file (PD-025). CI has no LLM key, so it checks the evidence, not the numbers.
test("a sim holdout gate file exists for the current classifier prompt version", () => {
  const dir = resolve(import.meta.dir, "../../../../../evals/results/gate");
  expect(gateEvidence(dir, prompts.classifier.version).length).toBeGreaterThan(0);
});

test("an own or eu gate file parses but is no evidence; a standard file is", () => {
  const dir = mkdtempSync(join(tmpdir(), "f111-gate-evidence-"));
  try {
    const source = resolve(import.meta.dir, "../../../../../evals/results/gate");
    const [name] = readdirSync(source).filter((file) => file.startsWith(`classifier-${prompts.classifier.version}-`));
    const standard = readFileSync(join(source, name as string), "utf8");
    const withEndpoint = (endpoint: string) => JSON.stringify({ ...JSON.parse(standard), endpoint, host: "127.0.0.1" });
    const base = (name as string).replace(/\.json$/, "");

    writeFileSync(join(dir, `${base}-own.json`), withEndpoint("own"));
    writeFileSync(join(dir, `${base}-eu.json`), withEndpoint("eu"));
    expect(gateEvidence(dir, prompts.classifier.version)).toEqual([]);

    // A file with another endpoint inside and no suffix in its name is no evidence either.
    writeFileSync(join(dir, `${base}-a.json`), withEndpoint("own"));
    expect(gateEvidence(dir, prompts.classifier.version)).toEqual([]);

    writeFileSync(join(dir, name as string), standard);
    expect(gateEvidence(dir, prompts.classifier.version)).toEqual([name as string]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken own gate file still fails the parse", () => {
  const dir = mkdtempSync(join(tmpdir(), "f111-gate-evidence-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `classifier-${prompts.classifier.version}-x-own.json`),
      JSON.stringify({ endpoint: "own" })
    );
    expect(() => gateEvidence(dir, prompts.classifier.version)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The runtime reader (F110 stage 02) must read the committed files as the server reads them at start. A change of
// the gate file format that the reader cannot parse fails here, not at the start of a release.
test("the runtime reader reads every committed classifier gate file with no warning", () => {
  const dir = resolve(import.meta.dir, "../../../../../evals/results/gate");
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
  const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const index = loadGateEvidence(dir);
    // Both classifier files (v2 and v3); the extractor file is no classifier evidence and is skipped with no warning.
    const classifierFiles = readdirSync(dir).filter((file) => file.startsWith("classifier-") && file.endsWith(".json"));
    expect(index.files.map((entry) => entry.file).sort()).toEqual(classifierFiles.sort());
    expect(errorSpy).not.toHaveBeenCalled();

    const v2 = index.files.find((entry) => entry.file === "classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json");
    expect(v2?.key).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
      reasoningEffort: "none",
      promptVersion: "classifier-v2",
      promptParts: null,
      endpoint: "standard",
      host: null,
    });
    expect(globalEvidenceFor(index, v2?.key as NonNullable<typeof v2>["key"]).info.file).toBe(v2?.file ?? "");
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
});
