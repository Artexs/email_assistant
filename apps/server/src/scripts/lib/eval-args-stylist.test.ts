import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseEvalArgs } from "../eval-args";

describe("parseEvalArgs: the stylist run", () => {
  test.each([
    ["sent-dev", ["--sim", "lab-01", "--part", "sent-dev", "--stylist"]],
    ["sent-holdout", ["--sim", "lab-01", "--part", "sent-holdout", "--stylist", "--stylist-prompt", "stylist-v1"]],
  ])("a %s part run is valid", (_label, args) => {
    expect(parseEvalArgs(args)).toMatchObject({ sim: "lab-01", stylist: true, drafter: false, judge: false });
  });

  test("the part and the prompt version reach the options; the cap defaults to $1", () => {
    const options = parseEvalArgs([
      "--sim",
      "lab-01",
      "--part",
      "sent-dev",
      "--stylist",
      "--stylist-prompt",
      "stylist-v1",
      "--budget-usd",
      "0.25",
    ]);
    expect(options).toMatchObject({ sentPart: "sent-dev", "stylist-prompt": "stylist-v1", budgetUsd: 0.25 });
    expect(parseEvalArgs(["--sim", "lab-01", "--part", "sent-dev", "--stylist"]).budgetUsd).toBe(1);
  });

  test("the injection set needs no corpus", () => {
    expect(parseEvalArgs(["--set", "style-injection", "--stylist"])).toMatchObject({
      set: "style-injection",
      stylist: true,
    });
  });

  test.each([
    ["an incoming part", ["--sim", "lab-01", "--part", "dev", "--stylist"]],
    ["no part", ["--sim", "lab-01", "--stylist"]],
    ["--judge", ["--sim", "lab-01", "--part", "sent-dev", "--stylist", "--judge"]],
    ["--drafter", ["--sim", "lab-01", "--part", "sent-dev", "--stylist", "--drafter"]],
    ["--extractor", ["--sim", "lab-01", "--part", "sent-dev", "--stylist", "--extractor"]],
    ["--limit", ["--sim", "lab-01", "--part", "sent-dev", "--stylist", "--limit", "3"]],
    ["--concurrency", ["--sim", "lab-01", "--part", "sent-dev", "--stylist", "--concurrency", "2"]],
    [
      "a corpus and the injection set",
      ["--sim", "lab-01", "--part", "sent-dev", "--set", "style-injection", "--stylist"],
    ],
    ["another set", ["--set", "injection", "--stylist"]],
    ["the injection set with a part", ["--set", "style-injection", "--part", "sent-dev", "--stylist"]],
    ["the injection set with --judge", ["--set", "style-injection", "--stylist", "--judge"]],
    ["no source", ["--stylist"]],
  ])("%s with --stylist is a usage error", (_label, args) => {
    expect(() => parseEvalArgs(args)).toThrow(UsageError);
  });

  test.each([
    ["a sent part without --stylist or --extractor", ["--sim", "lab-01", "--part", "sent-dev"]],
    ["--part sent-dev with --drafter and no --stylist", ["--sim", "lab-01", "--part", "sent-dev", "--drafter"]],
    [
      "--stylist-prompt with --extractor",
      ["--sim", "lab-01", "--part", "sent-dev", "--extractor", "--stylist-prompt", "stylist-v1"],
    ],
    ["--stylist-prompt without --stylist", ["--sim", "lab-01", "--part", "dev", "--stylist-prompt", "stylist-v1"]],
    ["--stylist-prompt with the classifier", ["--stylist-prompt", "stylist-v1"]],
    [
      "--stylist-prompt with --drafter",
      ["--sim", "lab-01", "--part", "dev", "--drafter", "--stylist-prompt", "stylist-v1"],
    ],
    ["the injection set with the classifier", ["--set", "style-injection"]],
    ["the injection set with --drafter", ["--set", "style-injection", "--drafter", "--judge"]],
    [
      "an unknown stylist prompt",
      ["--sim", "lab-01", "--part", "sent-dev", "--stylist", "--stylist-prompt", "stylist-v9"],
    ],
  ])("%s is a usage error", (_label, args) => {
    expect(() => parseEvalArgs(args)).toThrow(UsageError);
  });
});
