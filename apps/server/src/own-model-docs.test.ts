import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { subprocessors } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { startSource } from "./start/source.test-helper";

// The own-model guide and ADR 0035 state only what the repo can show: every link resolves, every number comes from its report,
// no page says that this install processes mail in the EU, no page says that a failing model "unlocks no auto" without the
// code that does it, the results part stays empty until a gate file of an own model exists, and the registry sentence of
// the guide matches the registry code.
const ROOT = path.resolve(import.meta.dir, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

const GUIDE = "docs/own-model.md";
const ADR = "docs/decisions/0035-llm-endpoint-eu-and-own-model.md";
const PATH_ROOTS = ["apps/", "packages/", "db/", "deploy/", "docs/", "tools/", "scripts/", "evals/", "notes/"];

const guide = read(GUIDE);
const adr = read(ADR);

/** Backticked repo paths of a text, without a line suffix or an anchor. Placeholders and wildcards are skipped. */
function pathTokens(markdown: string): string[] {
  const tokens: string[] = [];
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1] ?? "";
    if (/[\s<*{$]/.test(raw)) continue;
    const token = raw.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "");
    if (PATH_ROOTS.some((root) => token.startsWith(root))) tokens.push(token);
  }
  return tokens;
}

/** Targets of the Markdown links `[text](target)`, without an anchor; web links are skipped. */
function linkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => (match[1] ?? "").replace(/#.*$/, ""))
    .filter((target) => target !== "" && !/^[a-z]+:/.test(target));
}

/** The text of a `## ` section up to the next `## ` heading. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

const ownGateFiles = readdirSync(path.join(ROOT, "evals/results/gate")).filter((name) => name.endsWith("-own.json"));

describe("the own-model guide", () => {
  test("every repo path and every link resolves", () => {
    const missing: string[] = [];
    for (const token of pathTokens(guide)) {
      if (!existsSync(path.join(ROOT, token))) missing.push(token);
    }
    for (const target of linkTargets(guide)) {
      if (!existsSync(path.resolve(path.dirname(path.join(ROOT, GUIDE)), target))) missing.push(target);
    }
    expect(missing).toEqual([]);
  });

  test("the paths of the ADR amendment resolve", () => {
    const missing = pathTokens(adr).filter((token) => !existsSync(path.join(ROOT, token)));
    expect(missing).toEqual([]);
  });

  test("the volume numbers come from the report of the production prompt", () => {
    const report = read("evals/results/2026-11-15-sim-lab-01-holdout-gpt-6-luna-classifier-v2.md");
    const match = /average tokens in \/ out: (\d+) \/ (\d+)/.exec(report);
    expect(match).not.toBeNull();
    const tokensIn = Number(match?.[1]);
    const tokensOut = Number(match?.[2]);
    const withSeparator = (value: number): string => value.toLocaleString("en-US");
    expect(guide).toContain(
      `The mean of that run is ${tokensIn} prompt tokens and ${tokensOut} output tokens per mail.`
    );
    expect(guide).toContain(
      `${withSeparator(200 * tokensIn)} prompt tokens and ${withSeparator(200 * tokensOut)} output tokens a day`
    );
    expect(read("apps/server/src/modules/triage/prompts/index.ts")).toContain("classifier-v2");
  });

  test("while no gate file of an own model exists, the results and the hardware numbers say: not measured", () => {
    if (ownGateFiles.length > 0) return;
    expect(sectionOf(guide, "6. Results")).toBe("Not measured yet. Stage 05 adds the numbers after owner step O2.");
    for (const label of ["GPU memory in use", "Seconds per mail", "Longest prompt"]) {
      expect(guide).toMatch(new RegExp(`\\*\\*${label}:\\*\\* not measured yet \\(stage 05\\)`));
    }
  });

  test("the registry sentence matches the registry code", () => {
    const openai = subprocessors.find((row) => row.id === "openai");
    const conditionless = openai?.activeWhen.kind === "llmProvider";
    expect(conditionless).toBe(true);
    expect(guide).toContain("has no condition for the endpoint");
  });

  test("no sentence says that a failing model unlocks no auto", () => {
    for (const text of [guide, adr]) {
      expect(text).not.toMatch(/unlocks? no `?auto/i);
    }
  });

  test("the guide names the re-gate that the code has", () => {
    expect(existsSync(path.join(ROOT, "apps/server/src/modules/trust/regate.ts"))).toBe(true);
    expect(guide).toContain("The re-gate runs at every start and every 5 minutes.");
    expect(startSource()).toContain('regateAll({ ...regateDeps, run: "start" }');
  });
});

describe("ADR 0035 and the pages around it", () => {
  test("the ADR is accepted for decisions 1 to 5 and the index says the same", () => {
    expect(adr).toContain("- Status: accepted 2026-11-19 for decisions 1–5; decision 6 waits for the OpenAI answer");
    expect(read("docs/decisions/README.md")).toMatch(
      /\| 0035 \|[^\n]*\| accepted for decisions 1–5; decision 6 waits\s*\|/
    );
    expect(adr).toContain("## Amendment 2026-11-19");
  });

  test("no page says that this install processes mail in the EU", () => {
    const files = [
      ADR,
      "docs/architecture.md",
      GUIDE,
      ...readdirSync(path.join(ROOT, "docs/capabilities")).map((name) => `docs/capabilities/${name}`),
    ];
    const hits: string[] = [];
    for (const file of files) {
      for (const sentence of read(file).split(/(?<=[.!?])\s+|\n/)) {
        if (
          /\b(this install|the install|the pilot)\b[^.]*\b(processes|processed|runs|stays)\b[^.]*\bin the EU\b/i.test(
            sentence
          )
        ) {
          hits.push(`${file}: ${sentence.slice(0, 80)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  test("the triage page links the guide", () => {
    expect(read("docs/capabilities/triage.md")).toContain("[own-model.md](../own-model.md)");
  });
});
