import { type CliSpec, runCli } from "../platform/cli";

import { cliDescriptions, parseStyleGateArgs } from "./eval-style-gate-args";
import { runStyleGate } from "./lib/eval-style-gate";

const main: CliSpec["main"] = async (argv, out) => runStyleGate(parseStyleGateArgs(argv), { out });

if (import.meta.main) {
  await runCli({ prefix: "eval-style-gate", descriptions: cliDescriptions, main });
}
