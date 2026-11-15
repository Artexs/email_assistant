import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { EvidenceKey } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { uniformRoleTable } from "../../platform/llm";

import { globalEvidenceFor, loadGateEvidence, noGateEvidence, runningEvidenceKey } from "./evidence";
import { productionClassifierChoice } from "./prompts";

const REAL = resolve(import.meta.dir, "../../../../../evals/results/gate");
const V2 = JSON.parse(
  readFileSync(join(REAL, "classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json"), "utf8")
) as Record<string, unknown>;

const KEY: EvidenceKey = {
  provider: "openai",
  model: "gpt-6-luna",
  reasoningEffort: "none",
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};
const CATEGORIES = ["urgent", "needs_reply", "info", "notification", "spam"] as const;

let dir: string;
let warnSpy: ReturnType<typeof spyOn>;
let infoSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "f110-gate-"));
  warnSpy = spyOn(console, "error").mockImplementation(() => undefined);
  infoSpy = spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  warnSpy.mockRestore();
  infoSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

// A copy of the real v2 gate file with fields changed. `undefined` removes a field.
function put(name: string, over: Record<string, unknown> = {}): void {
  // JSON.stringify drops a key whose value is `undefined`.
  writeFileSync(join(dir, name), JSON.stringify({ ...V2, ...over }));
}

const warnLines = (): string[] => warnSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" "));
const files = (key: EvidenceKey): (string | null)[] => [
  ...new Set(CATEGORIES.map((category) => globalEvidenceFor(loadGateEvidence(dir), key)[category].file)),
];

describe("loadGateEvidence and globalEvidenceFor", () => {
  test("1: a file with no endpoint key is standard and matches the running key", () => {
    put("classifier-a.json", { endpoint: undefined, host: undefined });
    const evidence = globalEvidenceFor(loadGateEvidence(dir), KEY);
    expect(evidence.info.decision).toBe("go");
    expect(evidence.info.threshold).toBe(0.95);
    expect(evidence.info.provisional).toBe(true);
    expect(evidence.info.cases).toBe(243);
    expect(evidence.info.file).toBe("classifier-a.json");
    expect(warnLines()).toEqual([]);
  });

  test("2: the same file for the endpoint eu gives none for every category", () => {
    put("classifier-a.json", { endpoint: undefined, host: undefined });
    const evidence = globalEvidenceFor(loadGateEvidence(dir), { ...KEY, endpoint: "eu" });
    for (const category of CATEGORIES) expect(evidence[category]).toEqual(noEvidence);
  });

  test("3: a non-provisional file beats a newer provisional one", () => {
    put("classifier-a.json", { provisional: true, date: "2026-11-14" });
    put("classifier-b.json", { provisional: false, date: "2026-11-10" });
    expect(files(KEY)).toEqual(["classifier-b.json"]);
  });

  test("4: of two non-provisional files the newer date wins", () => {
    put("classifier-a.json", { provisional: false, date: "2026-11-10" });
    put("classifier-b.json", { provisional: false, date: "2026-11-14" });
    expect(files(KEY)).toEqual(["classifier-b.json"]);
    // The order of the names does not decide.
    put("classifier-c.json", { provisional: false, date: "2026-11-14", model: "other" });
    put("classifier-0.json", { provisional: false, date: "2026-11-12" });
    expect(files(KEY)).toEqual(["classifier-b.json"]);
  });

  test("4a: the same date and state: the smaller name wins", () => {
    put("classifier-b.json", { provisional: false });
    put("classifier-a.json", { provisional: false });
    expect(files(KEY)).toEqual(["classifier-a.json"]);
    // The result does not depend on the order of the index either.
    const index = loadGateEvidence(dir);
    const reversed = { files: [...index.files].reverse() };
    expect(globalEvidenceFor(reversed, KEY).info.file).toBe("classifier-a.json");
  });

  test("4b: a file that is not named classifier-*.json is not read, even with a good body", () => {
    put("other.json");
    put("classifier-a.txt");
    expect(loadGateEvidence(dir).files).toEqual([]);
    expect(warnLines()).toEqual([]);
  });

  test("5: another prompt version or reasoning effort does not match", () => {
    put("classifier-a.json", { promptVersion: "classifier-v3" });
    put("classifier-b.json", { reasoningEffort: "low" });
    put("classifier-c.json", { reasoningEffort: null });
    put("classifier-d.json", { model: "gpt-6-sol" });
    put("classifier-e.json", { provider: "gemini" });
    expect(files(KEY)).toEqual([null]);
  });

  test("6: a broken file next to a good one: the good one is read, one warn line, no throw", () => {
    put("classifier-a.json");
    writeFileSync(join(dir, "classifier-b.json"), "{ this is not json SECRET-BODY");
    put("classifier-c.json", { categories: undefined });
    const evidence = globalEvidenceFor(loadGateEvidence(dir), KEY);
    expect(evidence.info.file).toBe("classifier-a.json");
    expect(warnLines()).toHaveLength(1);
    expect(warnLines()[0]).toContain("gate_evidence_skipped");
    expect(warnLines()[0]).toContain("file=classifier-b.json");
    expect(warnLines()[0]).toContain("count=2");
    expect(warnLines()[0]).not.toContain("SECRET-BODY");
  });

  test("7: a missing directory gives an empty index, none for every category and one warn line", () => {
    const index = loadGateEvidence(join(dir, "missing"));
    expect(index.files).toEqual([]);
    for (const category of CATEGORIES) expect(globalEvidenceFor(index, KEY)[category]).toEqual(noEvidence);
    expect(warnLines()).toHaveLength(1);
    expect(warnLines()[0]).toContain("gate_evidence_dir_missing");
  });

  test("8: two own files for one model: the file of the running host wins", () => {
    put("classifier-a.json", { endpoint: "own", host: "llm-a" });
    put("classifier-b.json", { endpoint: "own", host: "llm-b", date: "2026-11-01" });
    const own: EvidenceKey = { ...KEY, endpoint: "own", host: "llm-b", reasoningEffort: null };
    expect(files(own)).toEqual(["classifier-b.json"]);
    expect(files({ ...own, host: "llm-c" })).toEqual([null]);
  });

  test("8a: the host counts only for own: a standard file matches any running host", () => {
    put("classifier-a.json", { host: "api.openai.com" });
    expect(files({ ...KEY, host: "elsewhere" })).toEqual(["classifier-a.json"]);
  });

  test("9: a file with promptParts does not match a running prompt with no parts, and the reverse", () => {
    put("classifier-a.json", { promptVersion: "classifier-v3", promptParts: ["list"] });
    const v3: EvidenceKey = { ...KEY, promptVersion: "classifier-v3" };
    expect(files({ ...v3, promptParts: null })).toEqual([null]);
    expect(files({ ...v3, promptParts: [] })).toEqual([null]);
    expect(files({ ...v3, promptParts: ["list"] })).toEqual(["classifier-a.json"]);
    put("classifier-b.json", { promptVersion: "classifier-v3" });
    expect(files({ ...v3, promptParts: null })).toEqual(["classifier-b.json"]);
  });

  test("10: an extractor file and an escalation file next to a good one are skipped with no warn line", () => {
    put("classifier-a.json");
    writeFileSync(join(dir, "extractor-x.json"), JSON.stringify({ role: "extractor", other: "schema" }));
    put("classifier-esc.json", { role: "escalation", model: "gpt-6-sol" });
    const index = loadGateEvidence(dir);
    expect(index.files.map((file) => file.file)).toEqual(["classifier-a.json"]);
    expect(warnLines()).toEqual([]);
  });

  test("a no-go: too few row reads as too-few and a provisional flag is carried to every category", () => {
    const categories = structuredClone(V2.categories) as Record<string, Record<string, unknown>>;
    categories.spam = { ...categories.spam, decision: "no-go: too few", threshold: null };
    put("classifier-a.json", { categories });
    const evidence = globalEvidenceFor(loadGateEvidence(dir), KEY);
    expect(evidence.spam.decision).toBe("too-few");
    expect(evidence.spam.provisional).toBe(true);
    expect(evidence.info.decision).toBe("go");
  });

  test("an own file that names an effort still matches an own running key (the adapter sends none)", () => {
    put("classifier-a.json", { endpoint: "own", host: "llm-a", reasoningEffort: "none" });
    expect(files({ ...KEY, endpoint: "own", host: "llm-a", reasoningEffort: null })).toEqual(["classifier-a.json"]);
  });

  test("a folder with no file of its own: the directory entry is ignored", () => {
    mkdirSync(join(dir, "classifier-dir.json"));
    expect(loadGateEvidence(dir).files).toEqual([]);
    expect(warnLines()).toHaveLength(1);
  });

  test("the empty deps of tools and tests carry no file", () => {
    expect(noGateEvidence.index.files).toEqual([]);
  });
});

describe("runningEvidenceKey", () => {
  const provider = { apiKeyName: "K", apiKey: "k", rpm: 10, baseUrl: null, endpoint: "standard" as const };
  const row = { provider: "openai" as const, model: "gpt-6-luna", timeoutMs: 1000, rpm: null, reasoningEffort: "none" };

  test("takes provider, model and effort from the classifier row and the production prompt", () => {
    expect(runningEvidenceKey(uniformRoleTable(row, provider))).toEqual(KEY);
  });

  test("v3 takes the sorted optional parts of the choice", () => {
    const key = runningEvidenceKey(
      uniformRoleTable(row, provider),
      productionClassifierChoice("classifier-v3", ["list", "attachments", "history"])
    );
    expect(key.promptVersion).toBe("classifier-v3");
    expect(key.promptParts).toEqual(["history", "list"]);
  });

  test("an own endpoint has host and no effort; a provider with no effort has null", () => {
    const own = runningEvidenceKey(
      uniformRoleTable(row, { ...provider, endpoint: "own", baseUrl: "http://llm-b:8000/v1" })
    );
    expect(own).toMatchObject({ endpoint: "own", host: "llm-b", reasoningEffort: null });
    const noEffort = runningEvidenceKey(uniformRoleTable({ ...row, reasoningEffort: null }, provider));
    expect(noEffort.reasoningEffort).toBeNull();
  });
});

const noEvidence = {
  decision: "none",
  provisional: false,
  precision: null,
  wilsonLower: null,
  threshold: null,
  cases: 0,
  file: null,
};
