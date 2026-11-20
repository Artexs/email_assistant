import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { productionClassifierChoice } from "../modules/triage";

import { parseEvalArgs, resolvePrompt, SIM_DEFAULT_CONCURRENCY, SIM_DEFAULT_RPM } from "./eval-args";

const org = "11111111-1111-4111-8111-111111111111";

describe("parseEvalArgs", () => {
  test("--sim with --real, --set or --per-category is a usage error", () => {
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--real"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--set", "all"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--per-category", "3"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--org-id", org])).toThrow(UsageError);
  });

  test("--state with --sim is a usage error: the corpus fixes the state file", () => {
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--state", "x.jsonl"])).toThrow(UsageError);
  });

  test("--sim needs --part dev|holdout|week", () => {
    expect(() => parseEvalArgs(["--sim", "lab-01"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "other"])).toThrow(UsageError);
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
    expect(() => parseEvalArgs(["--part", "dev"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--rpm", "100"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--fresh-lock"])).toThrow(UsageError);
  });

  test("--judge and its overrides belong to a sim run, and the overrides need --judge", () => {
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge"])).toMatchObject({ judge: true });
    expect(
      parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge", "--judge-provider", "gemini", "--judge-model", "m"])
    ).toMatchObject({ judge: true, "judge-provider": "gemini", "judge-model": "m" });
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev"])).toMatchObject({ judge: false });
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge-model", "m"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--judge"])).toThrow(UsageError);
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge", "--judge-rpm", "6"])).toMatchObject({
      "judge-rpm": 6,
    });
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge-rpm", "6"])).toThrow(UsageError);
  });

  test("the real mode keeps its rules", () => {
    expect(parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org])).toMatchObject({ real: true });
    expect(() => parseEvalArgs(["--real", "--org-id", org])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org, "--set", "all"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--org-id", org])).toThrow(UsageError);
  });

  test("--real takes --json-out <file>", () => {
    expect(parseEvalArgs(["--real", "--json-out", "/tmp/x.json", "--org-id", org, "--mailbox-id", org])).toMatchObject({
      jsonOut: "/tmp/x.json",
    });
    expect(() => parseEvalArgs(["--json-out", "c.json"])).toThrow(UsageError);
  });

  test("the old --json is a usage error that names --json-out", () => {
    const args = ["--real", "--org-id", org, "--mailbox-id", org, "--json", "/tmp/x.json"];
    expect(() => parseEvalArgs(args)).toThrow(UsageError);
    expect(() => parseEvalArgs(args)).toThrow("--json-out");
  });

  test("an unknown flag is a usage error", () => {
    expect(() => parseEvalArgs(["--no-such-flag"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--no-such-flag"])).toThrow(UsageError);
  });

  test("--gap takes two files and --out only", () => {
    expect(parseEvalArgs(["--gap", "--sim-json", "g.json", "--real-json", "c.json", "--out", "r.md"])).toMatchObject({
      gap: true,
    });
    expect(() => parseEvalArgs(["--gap", "--sim-json", "g.json"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--gap", "--sim-json", "g.json", "--real-json", "c.json", "--model", "m"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs(["--gap", "--sim-json", "g.json", "--real-json", "c.json", "--judge"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--sim-json", "g.json"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim-json", "g.json"])).toThrow(UsageError);
  });
});

describe("--prompt-version and --prompt-parts (F109 stage 08)", () => {
  const sim = ["--sim", "lab-01", "--part", "dev"];

  test("6. v2 with --prompt-parts is a usage error; an unknown or empty part is a usage error", () => {
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v2", "--prompt-parts", "urgency"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v2", "--prompt-parts", "none"])).toThrow(
      UsageError
    );
    // Without --prompt-version the production pointer (v2 today) decides.
    expect(() => parseEvalArgs([...sim, "--prompt-parts", "urgency"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--prompt-parts", "foo"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "foo"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "urgency,foo"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", ""])).toThrow(
      UsageError
    );
    expect(() =>
      parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "none,urgency"])
    ).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v9"])).toThrow(UsageError);
  });

  test("v4 takes the part profile (sorted with the others); v3 refuses it", () => {
    expect(
      parseEvalArgs([...sim, "--prompt-version", "classifier-v4", "--prompt-parts", "profile,list"])?.prompt
    ).toEqual({ version: "classifier-v4", parts: ["list", "profile"] });
    expect(parseEvalArgs([...sim, "--prompt-version", "classifier-v4", "--prompt-parts", "none"])?.prompt).toEqual({
      version: "classifier-v4",
      parts: [],
    });
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v3", "--prompt-parts", "profile"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs([...sim, "--prompt-version", "classifier-v4", "--prompt-parts", "foo"])).toThrow(
      UsageError
    );
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
    expect(() => parseEvalArgs(["--prompt-version", "classifier-v3"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--prompt-parts", "none"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--suspicious", "--prompt-version", "classifier-v3"])).toThrow(UsageError);
    expect(() =>
      parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org, "--prompt-version", "classifier-v3"])
    ).toThrow(UsageError);
  });

  // The escalation cascade is gone, so its flags are unknown options.
  test("--escalate and the --escalation-* flags are a usage error", () => {
    const sim = ["--sim", "lab-01", "--part", "dev"];
    expect(() => parseEvalArgs([...sim, "--escalate"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--escalation-model", "gpt-6.1-terra"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--escalation-reasoning-effort", "none"])).toThrow(UsageError);
  });

  // Both flags are pinned to the production prompt when v3 is the pointer.
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

describe("--extractor", () => {
  const base = ["--sim", "lab-01", "--part", "sent-dev", "--extractor"];

  test("T5 a sent part without --extractor is a usage error, also the holdout", () => {
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "sent-holdout"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "sent-dev"])).toThrow(UsageError);
  });

  test("--extractor needs --sim and a sent part", () => {
    expect(() => parseEvalArgs(["--extractor"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--extractor"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--extractor"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "holdout", "--extractor"])).toThrow(UsageError);
  });

  test("a sent part with --extractor parses to sentPart; the cap and rates default as in a sim run", () => {
    for (const part of ["sent-dev", "sent-holdout"] as const) {
      const options = parseEvalArgs(["--sim", "lab-01", "--part", part, "--extractor"]);
      expect(options).toMatchObject({
        sim: "lab-01",
        sentPart: part,
        extractor: true,
        concurrency: SIM_DEFAULT_CONCURRENCY,
        rpm: SIM_DEFAULT_RPM,
        budgetUsd: 1,
      });
      expect(options?.part).toBeUndefined();
    }
    expect(parseEvalArgs([...base, "--budget-usd", "0.5", "--rpm", "60", "--model", "m"])).toMatchObject({
      budgetUsd: 0.5,
      rpm: 60,
      model: "m",
    });
  });

  test("the classifier options and the other modes are refused", () => {
    for (const extra of [
      ["--judge"],
      ["--suspicious"],
      ["--prompt-version", "classifier-v2"],
      ["--prompt-parts", "none"],
      ["--bar", "0.9"],
      ["--min-kept", "10"],
      ["--real"],
      ["--set", "all"],
      ["--state", "x.jsonl"],
    ]) {
      expect(() => parseEvalArgs([...base, ...extra])).toThrow(UsageError);
    }
  });

  test("the old modes refuse --extractor and a sent part", () => {
    expect(() => parseEvalArgs(["--extractor", "--real", "--org-id", org, "--mailbox-id", org])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "sent-dev", "--suspicious"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--gap", "--extractor", "--sim-json", "a", "--real-json", "b"])).toThrow(UsageError);
  });
});

describe("--drafter", () => {
  const sim = ["--sim", "lab-01", "--part", "dev", "--drafter"];
  const set = ["--set", "reply-injection", "--drafter", "--judge"];

  test("the reply injection set with the judge parses; the budget and rates are the run options", () => {
    expect(parseEvalArgs([...set, "--budget-usd", "2"])).toMatchObject({
      set: "reply-injection",
      drafter: true,
      judge: true,
      budgetUsd: 2,
      concurrency: SIM_DEFAULT_CONCURRENCY,
      rpm: SIM_DEFAULT_RPM,
    });
    expect(parseEvalArgs([...set, "--model", "m", "--judge-provider", "gemini", "--out", "r.md"])).toMatchObject({
      model: "m",
      "judge-provider": "gemini",
    });
  });

  test("an incoming part parses with and without the judge; a sent part does not", () => {
    for (const part of ["dev", "holdout", "week"]) {
      expect(parseEvalArgs(["--sim", "lab-01", "--part", part, "--drafter", "--judge"])).toMatchObject({
        sim: "lab-01",
        part,
        drafter: true,
        judge: true,
      });
    }
    expect(parseEvalArgs(sim)).toMatchObject({ drafter: true, judge: false, budgetUsd: 1 });
    for (const part of ["sent-dev", "sent-holdout"]) {
      expect(() => parseEvalArgs(["--sim", "lab-01", "--part", part, "--drafter"])).toThrow(UsageError);
    }
  });

  test("the old sets with the judge, and the injection set without --drafter, are usage errors", () => {
    expect(() => parseEvalArgs(["--set", "all", "--judge"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--set", "reply-injection"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--set", "reply-injection", "--judge"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--set", "all", "--drafter", "--judge"])).toThrow(UsageError);
    // The injection set is a gate: it always needs the judge.
    expect(() => parseEvalArgs(["--set", "reply-injection", "--drafter"])).toThrow(UsageError);
  });

  test("--drafter and --extractor, or any other mode, is a usage error", () => {
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "sent-dev", "--drafter", "--extractor"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs([...sim, "--extractor"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--suspicious"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...set, "--extractor"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--drafter", "--real", "--org-id", org, "--mailbox-id", org])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--drafter", "--gap", "--sim-json", "a", "--real-json", "b"])).toThrow(UsageError);
  });

  test("--drafter needs exactly one source and refuses the classifier options", () => {
    expect(() => parseEvalArgs(["--drafter"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--drafter", "--judge"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--set", "reply-injection"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...set, "--sim", "lab-01", "--part", "dev"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...set, "--part", "dev"])).toThrow(UsageError);
    for (const extra of [
      ["--prompt-version", "classifier-v2"],
      ["--prompt-parts", "none"],
      ["--bar", "0.9"],
      ["--min-kept", "10"],
      ["--state", "x.jsonl"],
      ["--per-category", "2"],
    ]) {
      expect(() => parseEvalArgs([...sim, ...extra])).toThrow(UsageError);
    }
  });

  test("the judge options need --judge", () => {
    expect(() => parseEvalArgs([...sim, "--judge-provider", "gemini"])).toThrow(UsageError);
    expect(parseEvalArgs([...sim, "--judge", "--judge-provider", "gemini"])).toBeDefined();
  });

  test("--drafter-prompt takes a known drafter version; other modes refuse it", () => {
    expect(parseEvalArgs([...sim, "--drafter-prompt", "drafter-v1"])).toMatchObject({ "drafter-prompt": "drafter-v1" });
    expect(parseEvalArgs([...set, "--drafter-prompt", "drafter-v1"])).toBeDefined();
    expect(() => parseEvalArgs([...sim, "--drafter-prompt", "drafter-v0"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--drafter-prompt", "drafter-v1"])).toThrow(
      UsageError
    );
    expect(() => parseEvalArgs(["--drafter-prompt", "drafter-v1"])).toThrow(UsageError);
  });

  test("--judge-prompt takes a known judge version and needs --judge; the classifier run refuses it", () => {
    expect(parseEvalArgs([...sim, "--judge", "--judge-prompt", "judge-v1"])).toMatchObject({
      "judge-prompt": "judge-v1",
    });
    expect(() => parseEvalArgs([...sim, "--judge-prompt", "judge-v2"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...sim, "--judge", "--judge-prompt", "judge-v9"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--judge", "--judge-prompt", "judge-v1"])).toThrow(
      UsageError
    );
  });

  test("--dump-drafts runs only on the dev and week parts: never on the holdout or the injection set", () => {
    expect(parseEvalArgs([...sim, "--dump-drafts", "d.jsonl"])).toMatchObject({ "dump-drafts": "d.jsonl" });
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "week", "--drafter", "--dump-drafts", "d.jsonl"])).toMatchObject(
      { part: "week", "dump-drafts": "d.jsonl" }
    );
    expect(() =>
      parseEvalArgs(["--sim", "lab-01", "--part", "holdout", "--drafter", "--dump-drafts", "d.jsonl"])
    ).toThrow(UsageError);
    expect(() => parseEvalArgs([...set, "--dump-drafts", "d.jsonl"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--sim", "lab-01", "--part", "dev", "--dump-drafts", "d.jsonl"])).toThrow(UsageError);
  });

  test("--set reply-commitment is a drafter set with the judge; it alone of the two sets may dump drafts", () => {
    const commitment = ["--set", "reply-commitment", "--drafter", "--judge"];
    expect(parseEvalArgs(commitment)).toMatchObject({ set: "reply-commitment", drafter: true, judge: true });
    expect(parseEvalArgs([...commitment, "--dump-drafts", "d.jsonl"])).toMatchObject({ "dump-drafts": "d.jsonl" });
    // No judge, a corpus part, or the classifier run: usage errors.
    expect(() => parseEvalArgs(["--set", "reply-commitment", "--drafter"])).toThrow(UsageError);
    expect(() => parseEvalArgs([...commitment, "--sim", "lab-01", "--part", "dev"])).toThrow(UsageError);
    expect(() => parseEvalArgs(["--set", "reply-commitment"])).toThrow(UsageError);
  });
});
