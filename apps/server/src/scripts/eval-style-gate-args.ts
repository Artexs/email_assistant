import { type CliDescription, UsageError } from "@ea/core";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "eval:style-gate",
    summary: "Compares two judged drafter runs, with and without a style: gate file, or with --smoke a verdict.",
    risk: "write",
    needs: ["none"],
    usage: [
      "bun run eval:style-gate --a <state file> --b <state file> --style <style file> --injection <injection result file> --out <report.md>",
      "  --a is the holdout run with --style none, --b the same run with --style <style file>; both with --judge-prompt judge-v4.",
      "  It reads the files and the holdout case ids, makes no model call and spends nothing.",
      "  It writes the gate file of the stylist prompt only for two full, judged holdout runs that differ in the style alone.",
      "bun run eval:style-gate --smoke --a <state file> --b <state file> --style <style file> --out <report.md>",
      "  Smoke mode takes two judged runs of part dev or week and refuses a holdout run (exit 2). It needs no --injection,",
      "  reads no holdout case, writes no gate file and makes no model call. The verdict is pass (smoke), fail (smoke) or judge stop:",
      "  B passes when its style_match mean is above A or it wins more pairs than it loses; judge stop when a run has over 5% judge",
      "  errors or every score is the same. Exit 0 for pass, 1 for fail and judge stop, 2 for a refused pair.",
    ].join("\n"),
    exits: {
      1: "a bar failed, a run is not eligible, a file did not load, or the smoke verdict is fail or judge stop",
    },
    outputNote:
      "counts, rates and codes only; no mail text or style text (a smoke report adds the case ids with two scores each)",
  },
] satisfies readonly CliDescription[];

export interface StyleGateArgs {
  a: string;
  b: string;
  style: string;
  // The injection result file; null in smoke mode.
  injection: string | null;
  out: string;
  smoke: boolean;
}

// Every path flag is required, except `--injection`, which smoke mode refuses. The parser reads no file.
export function parseStyleGateArgs(argv: string[]): StyleGateArgs {
  const { values } = parseFlags({
    args: argv,
    options: {
      a: { type: "string" },
      b: { type: "string" },
      style: { type: "string" },
      injection: { type: "string" },
      out: { type: "string" },
      smoke: { type: "boolean" },
    },
  });
  const smoke = values.smoke === true;
  const flags = smoke ? (["a", "b", "style", "out"] as const) : (["a", "b", "style", "injection", "out"] as const);
  const missing = flags.filter((flag) => values[flag] === undefined || values[flag] === "");
  if (missing.length > 0) throw new UsageError(`missing argument: ${missing.map((flag) => `--${flag}`).join(", ")}`);
  if (smoke && values.injection !== undefined) throw new UsageError("--injection is not used with --smoke");
  return {
    a: values.a as string,
    b: values.b as string,
    style: values.style as string,
    injection: smoke ? null : (values.injection as string),
    out: values.out as string,
    smoke,
  };
}
