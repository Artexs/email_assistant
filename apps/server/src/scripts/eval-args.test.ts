import { describe, expect, test } from "bun:test";

import { productionClassifierChoice } from "../modules/triage";

import { parseEvalArgs, resolvePrompt, SIM_DEFAULT_CONCURRENCY, SIM_DEFAULT_RPM } from "./eval-args";

const org = "11111111-1111-4111-8111-111111111111";

describe("parseEvalArgs", () => {
  test("--sim with --real, --set or --per-category is a usage error", () => {
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--real"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--set", "all"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--per-category", "3"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--org-id", org])).toBeUndefined();
  });

  test("--state with --sim is a usage error: the corpus fixes the state file", () => {
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--state", "x.jsonl"])).toBeUndefined();
  });

  test("--sim needs --part dev|holdout|week", () => {
    expect(parseEvalArgs(["--sim", "lab-01"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "other"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "week"])).toMatchObject({ sim: "lab-01", part: "week" });
  });

  test("--sim defaults to concurrency 8, rpm 240 and a $1 run cap; explicit values win", () => {
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev"])).toMatchObject({
      concurrency: SIM_DEFAULT_CONCURRENCY,
      rpm: SIM_DEFAULT_RPM,
      budgetUsd: 1,
    });
    expect(SIM_DEFAULT_CONCURRENCY).toBe(8);
    expect(SIM_DEFAULT_RPM).toBe(240);
    expect(
      parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--rpm", "100", "--concurrency", "2", "--budget-usd", "0.5"])
    ).toMatchObject({ concurrency: 2, rpm: 100, budgetUsd: 0.5 });
  });

  test("the old mode runs one case at a time and has no rpm override", () => {
    const options = parseEvalArgs(["--set", "synthetic"]);
    expect(options).toMatchObject({ concurrency: 1, set: "synthetic" });
    expect(options?.rpm).toBeUndefined();
  });

  test("a sim-only option without --sim is a usage error", () => {
    expect(parseEvalArgs(["--part", "dev"])).toBeUndefined();
    expect(parseEvalArgs(["--rpm", "100"])).toBeUndefined();
    expect(parseEvalArgs(["--fresh-lock"])).toBeUndefined();
  });

  test("--judge and its overrides belong to a sim run, and the overrides need --judge", () => {
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge"])).toMatchObject({ judge: true });
    expect(
      parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge", "--judge-provider", "gemini", "--judge-model", "m"])
    ).toMatchObject({ judge: true, "judge-provider": "gemini", "judge-model": "m" });
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev"])).toMatchObject({ judge: false });
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge-model", "m"])).toBeUndefined();
    expect(parseEvalArgs(["--judge"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge", "--judge-rpm", "6"])).toMatchObject({
      "judge-rpm": 6,
    });
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge-rpm", "6"])).toBeUndefined();
  });

  test("the real mode keeps its rules", () => {
    expect(parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org])).toMatchObject({ real: true });
    expect(parseEvalArgs(["--real", "--org-id", org])).toBeUndefined();
    expect(parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org, "--set", "all"])).toBeUndefined();
    expect(parseEvalArgs(["--org-id", org])).toBeUndefined();
  });

  test("--real takes --json; --gap takes two files and --out only", () => {
    expect(parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org, "--json", "c.json"])).toMatchObject({
      json: "c.json",
    });
    expect(parseEvalArgs(["--json", "c.json"])).toBeUndefined();
    expect(parseEvalArgs(["--gap", "--sim-json", "g.json", "--real-json", "c.json", "--out", "r.md"])).toMatchObject({
      gap: true,
    });
    expect(parseEvalArgs(["--gap", "--sim-json", "g.json"])).toBeUndefined();
    expect(parseEvalArgs(["--gap", "--sim-json", "g.json", "--real-json", "c.json", "--model", "m"])).toBeUndefined();
    expect(parseEvalArgs(["--gap", "--sim-json", "g.json", "--real-json", "c.json", "--judge"])).toBeUndefined();
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--sim-json", "g.json"])).toBeUndefined();
    expect(parseEvalArgs(["--sim-json", "g.json"])).toBeUndefined();
  });
});

describe("--prompt-version and --prompt-parts (F109 stage 08)", () => {
  const sim = ["--sim", "lab-01", "--part", "dev"];

  test("6. v2 with --prompt-parts is a usage error; an unknown or empty part is a usage error", () => {
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v2", "--prompt-parts", "urgency"])).toBeUndefined();
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v2", "--prompt-parts", "none"])).toBeUndefined();
    // Without --prompt-version the production pointer (v2 today) decides.
    expect(parseEvalArgs([...sim, "--prompt-parts", "urgency"])).toBeUndefined();
    expect(parseEvalArgs([...sim, "--prompt-parts", "foo"])).toBeUndefined();
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "foo"])).toBeUndefined();
    expect(
      parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "urgency,foo"])
    ).toBeUndefined();
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", ""])).toBeUndefined();
    expect(
      parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "none,urgency"])
    ).toBeUndefined();
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v9"])).toBeUndefined();
  });

  test("6. v3 without --prompt-parts while the pointer is v2 gives the parts none", () => {
    expect(productionClassifierChoice().version).toBe("classifier-v2");
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v3"])?.prompt).toEqual({
      version: "classifier-v3",
      parts: [],
    });
  });

  test("the parts are sorted by name; none and attachments mean attachments only", () => {
    const parts = (text: string) =>
      parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", text])?.prompt.parts;
    expect(parts("list,urgency,history")).toEqual(["history", "list", "urgency"]);
    expect(parts("history,history")).toEqual(["history"]);
    expect(parts("none")).toEqual([]);
    expect(parts("attachments")).toEqual([]);
  });

  test("a run with no prompt flag uses the production prompt", () => {
    expect(parseEvalArgs(sim)?.prompt).toEqual(productionClassifierChoice());
    expect(parseEvalArgs(["--set", "synthetic"])?.prompt).toEqual(productionClassifierChoice());
  });

  test("the flags belong to a sim run, not to the old, real, gap or suspicious mode", () => {
    expect(parseEvalArgs(["--prompt-version", "classifier-v3"])).toBeUndefined();
    expect(parseEvalArgs(["--prompt-parts", "none"])).toBeUndefined();
    expect(parseEvalArgs([...sim, "--suspicious", "--prompt-version", "classifier-v3"])).toBeUndefined();
    expect(
      parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org, "--prompt-version", "classifier-v3"])
    ).toBeUndefined();
  });

  // Review N5: both flags are pinned to the production prompt when v3 is the pointer.
  describe("N5: the production pointer is v3", () => {
    const production = productionClassifierChoice("classifier-v3", ["attachments", "list", "urgency"]);

    test("the default parts are the production parts", () => {
      expect(production).toEqual({ version: "classifier-v3", parts: ["list", "urgency"] });
      expect(resolvePrompt(undefined, undefined, production)).toEqual(production);
      expect(resolvePrompt("classifier-v3", undefined, production)).toEqual(production);
    });

    test("an explicit list or none overrides them; v2 has no parts", () => {
      expect(resolvePrompt("classifier-v3", "history", production)).toEqual({
        version: "classifier-v3",
        parts: ["history"],
      });
      expect(resolvePrompt("classifier-v3", "none", production)).toEqual({ version: "classifier-v3", parts: [] });
      expect(resolvePrompt("classifier-v2", undefined, production)).toEqual({ version: "classifier-v2", parts: [] });
      expect(resolvePrompt("classifier-v2", "urgency", production)).toBeUndefined();
    });

    test("a v2 pointer gives no parts, whatever the v3 list is", () => {
      expect(productionClassifierChoice("classifier-v2", ["urgency"])).toEqual({ version: "classifier-v2", parts: [] });
    });
  });
});
