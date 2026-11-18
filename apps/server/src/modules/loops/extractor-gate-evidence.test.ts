import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "bun:test";

import { prompts } from "../triage";

import { scoresAtBars } from "./extractor-fixtures.test-helper";
import { buildExtractorGateFile, extractorGateEvidence } from "./extractor-report";

const gateDir = resolve(import.meta.dir, "../../../../../evals/results/gate");

// A prompt or model change of the extractor needs a passing sim holdout gate file. CI has no LLM key, so it checks
// the evidence, not the numbers. Analysis does not start without this check green: there is no
// runtime check of the file.
test("a passing standard gate file exists for the current extractor prompt version", () => {
  expect(extractorGateEvidence(gateDir, prompts.extractor.version).length).toBeGreaterThan(0);
});

const identity = {
  scenario: "lab-01",
  version: "sent-v1",
  partSha: "b".repeat(64),
  provider: "openai",
  endpoint: "standard" as const,
  host: null,
  model: "gpt-6-luna",
  reasoningEffort: null,
  promptVersion: prompts.extractor.version,
  now: new Date("2026-11-15T10:00:00Z"),
};

function withTemp(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "f116-extractor-gate-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const name = (suffix = "") => `extractor-${prompts.extractor.version}-gpt-6-luna-default-lab-01-vsent-v1${suffix}.json`;
const write = (dir: string, file: string, value: unknown) => writeFileSync(join(dir, file), JSON.stringify(value));

test("T6 the check fails on an empty folder and passes with a passing fixture file", () => {
  withTemp((dir) => {
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
    write(dir, name(), buildExtractorGateFile(scoresAtBars(), identity));
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([name()]);
  });
});

test("a failed gate file is no evidence", () => {
  withTemp((dir) => {
    const failing = scoresAtBars();
    failing.injection.leaks = 1;
    write(dir, name(), buildExtractorGateFile(failing, identity));
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
  });
});

test("a file with every number at its bar but passed false is no evidence", () => {
  withTemp((dir) => {
    write(dir, name(), { ...buildExtractorGateFile(scoresAtBars(), identity), passed: false });
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
  });
});

test("a file with passed true but a number under its bar is no evidence", () => {
  withTemp((dir) => {
    const file = buildExtractorGateFile(scoresAtBars(), identity);
    write(dir, name(), { ...file, numbers: { ...file.numbers, replyRecallLower: 0.5 } });
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
  });
});

test("a passing file with an error case is no evidence", () => {
  withTemp((dir) => {
    const file = buildExtractorGateFile(scoresAtBars(), identity);
    write(dir, name(), { ...file, errors: 1 });
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
    write(dir, name("-ok"), { ...file, errors: 0 });
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([name("-ok")]);
  });
});

test("an own or eu file parses but is no evidence; a file of another prompt version is not read as evidence", () => {
  withTemp((dir) => {
    const file = buildExtractorGateFile(scoresAtBars(), identity);
    write(dir, name("-own"), { ...file, endpoint: "own", host: "127.0.0.1" });
    write(dir, name("-eu"), { ...file, endpoint: "eu", host: "eu.example.test" });
    // An endpoint inside the file with no suffix in the name is no evidence either.
    write(dir, name("-a"), { ...file, endpoint: "own", host: "127.0.0.1" });
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
    write(dir, "extractor-extractor-v0-other.json", file);
    write(dir, name("-v0"), { ...file, promptVersion: "extractor-v0" });
    expect(extractorGateEvidence(dir, prompts.extractor.version)).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(5);
  });
});

test("a broken gate file of the prompt version fails the parse", () => {
  withTemp((dir) => {
    mkdirSync(dir, { recursive: true });
    write(dir, name("-x"), { role: "extractor" });
    expect(() => extractorGateEvidence(dir, prompts.extractor.version)).toThrow();
  });
});
