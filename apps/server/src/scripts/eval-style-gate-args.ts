import { type CliDescription, UsageError } from "@ea/core";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "eval:style-gate",
    summary: "Compares two judged drafter runs, with and without a suggested style, and writes the gate file.",
    risk: "write",
    needs: ["none"],
    usage: [
      "bun run eval:style-gate --a <state file> --b <state file> --style <style file> --injection <injection result file> --out <report.md>",
      "  --a is the holdout run with --style none, --b the same run with --style <style file>; both with --judge-prompt judge-v4.",
      "  It reads the files and the holdout case ids, makes no model call and spends nothing.",
      "  It writes the gate file of the stylist prompt only for two full, judged holdout runs that differ in the style alone.",
    ].join("\n"),
    exits: { 1: "a bar failed, a run is not eligible for the gate file, or a file did not load" },
    outputNote: "counts, rates and codes only; no case id, mail text or style text",
  },
] satisfies readonly CliDescription[];

export interface StyleGateArgs {
  a: string;
  b: string;
  style: string;
  injection: string;
  out: string;
}

const FLAGS = ["a", "b", "style", "injection", "out"] as const;

// Every flag is required and takes a path. The parser reads no file.
export function parseStyleGateArgs(argv: string[]): StyleGateArgs {
  const { values } = parseFlags({
    args: argv,
    options: {
      a: { type: "string" },
      b: { type: "string" },
      style: { type: "string" },
      injection: { type: "string" },
      out: { type: "string" },
    },
  });
  const missing = FLAGS.filter((flag) => values[flag] === undefined || values[flag] === "");
  if (missing.length > 0) throw new UsageError(`missing argument: ${missing.map((flag) => `--${flag}`).join(", ")}`);
  return {
    a: values.a as string,
    b: values.b as string,
    style: values.style as string,
    injection: values.injection as string,
    out: values.out as string,
  };
}
