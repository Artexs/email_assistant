import { describe, expect, test } from "bun:test";

import { parseEvalArgs, SIM_DEFAULT_CONCURRENCY, SIM_DEFAULT_RPM } from "./eval-args";

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

  test("the real mode keeps its rules", () => {
    expect(parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org])).toMatchObject({ real: true });
    expect(parseEvalArgs(["--real", "--org-id", org])).toBeUndefined();
    expect(parseEvalArgs(["--real", "--org-id", org, "--mailbox-id", org, "--set", "all"])).toBeUndefined();
    expect(parseEvalArgs(["--org-id", org])).toBeUndefined();
  });
});
