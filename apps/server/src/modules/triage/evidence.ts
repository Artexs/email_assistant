// The global evidence of the running classifier: the gate files in the image, read once at start (F110 D1, D2, P9).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type BarCategory,
  barCategories,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GateIndex,
  type GateIndexFile,
  type GlobalEvidence,
  sameKey,
} from "@ea/core";

import { llmEndpointFields, type LlmRoleTable } from "../../platform/llm";
import { createLog } from "../../platform/log";

import { type GateFile, gateFileSchema } from "./eval-sim-report";
import { type ClassifierPromptChoice, optionalParts, productionClassifierChoice } from "./prompts";

const log = createLog("triage");

const NONE: GlobalEvidence = {
  decision: "none",
  provisional: false,
  precision: null,
  wilsonLower: null,
  threshold: null,
  cases: 0,
  file: null,
};

const decisionOf = (decision: GateFile["categories"]["info"]["decision"]): GlobalEvidence["decision"] =>
  decision === "no-go: too few" ? "too-few" : decision;

/**
 * An own server gets no effort setting (the OpenAI adapter drops it), so the effort is no part of its identity.
 * The gate file of an own run may name the role row's effort; the running key says `null`.
 */
const effortOf = (endpoint: EvidenceKey["endpoint"], effort: string | null): string | null =>
  endpoint === "own" ? null : effort;

function indexFileOf(file: string, parsed: GateFile): GateIndexFile {
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    const row = parsed.categories[category];
    categories[category] = {
      decision: decisionOf(row.decision),
      provisional: parsed.provisional,
      precision: row.precision,
      wilsonLower: row.wilsonLower,
      threshold: row.threshold,
      cases: row.support,
      file,
    };
  }
  return {
    key: {
      provider: parsed.provider,
      model: parsed.model,
      reasoningEffort: effortOf(parsed.endpoint, parsed.reasoningEffort),
      promptVersion: parsed.promptVersion,
      promptParts: parsed.promptParts === undefined ? null : [...parsed.promptParts],
      endpoint: parsed.endpoint,
      host: parsed.host,
    },
    file,
    date: parsed.date,
    provisional: parsed.provisional,
    categories,
  };
}

/** `undefined`: not a classifier file (another name, or another role): skip it with no warning. */
function roleOf(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null || !("role" in raw)) return undefined;
  return typeof raw.role === "string" ? raw.role : undefined;
}

/**
 * Reads `classifier-*.json` files with `role: "classifier"` (an `extractor` file has another schema; an `escalation`
 * file proves a cascade). A missing directory or a file that does not parse is no start error: one `warn` line with
 * the name of the first such file and the count (no content), and the file is skipped.
 */
export function loadGateEvidence(dir: string): GateIndex {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.startsWith("classifier-") && name.endsWith(".json"))
      .sort();
  } catch {
    log.warn("gate_evidence_dir_missing", { count: 0 });
    return { files: [] };
  }
  const files: GateIndexFile[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
      const role = roleOf(raw);
      if (role !== undefined && role !== "classifier") continue;
      files.push(indexFileOf(name, gateFileSchema.parse(raw)));
    } catch {
      skipped.push(name);
    }
  }
  if (skipped.length > 0) log.warn("gate_evidence_skipped", { count: skipped.length, file: skipped[0] ?? null });
  log.info("gate_evidence_loaded", { count: files.length });
  return { files };
}

/** The key of the classifier that runs now: the role row, the production prompt choice and the checked endpoint. */
export function runningEvidenceKey(
  table: LlmRoleTable,
  prompt: ClassifierPromptChoice = productionClassifierChoice()
): EvidenceKey {
  const { provider, model, endpoint, host } = llmEndpointFields(table, "classifier");
  const row = table.roles.classifier;
  return {
    provider,
    model,
    reasoningEffort: effortOf(endpoint, row.reasoningEffort),
    promptVersion: prompt.version,
    // The parts count only for v3 (`productionClassifierChoice` gives none for v2); `attachments` is always on.
    promptParts: optionalParts(prompt.parts).length > 0 ? optionalParts(prompt.parts) : null,
    endpoint,
    host,
  };
}

// Non-provisional first, then the newest date, then the name (D2).
const rank = (a: GateIndexFile, b: GateIndexFile): number =>
  Number(a.provisional) - Number(b.provisional) || b.date.localeCompare(a.date) || a.file.localeCompare(b.file);

/** The evidence of the best file for the key per category; no file for the key: `none` for every category. */
export function globalEvidenceFor(index: GateIndex, key: EvidenceKey): Record<BarCategory, GlobalEvidence> {
  const best = index.files.filter((entry) => sameKey(entry.key, key)).sort(rank)[0];
  if (best === undefined) {
    return Object.fromEntries(barCategories.map((category) => [category, NONE])) as Record<BarCategory, GlobalEvidence>;
  }
  return best.categories;
}

/** For tests and tools with no classifier: no file, so every category has no evidence (a closed gate). */
const NO_CLASSIFIER = "none";
export const noGateEvidence: GateEvidenceDeps = {
  index: { files: [] },
  runningKey: {
    provider: NO_CLASSIFIER,
    model: NO_CLASSIFIER,
    reasoningEffort: null,
    promptVersion: NO_CLASSIFIER,
    promptParts: null,
    endpoint: "standard",
    host: null,
  },
};
