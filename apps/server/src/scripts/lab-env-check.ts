import { resolve } from "node:path";

import { checkSimEnv } from "@ea/core";

import { labAddresses, loadLabCorpus } from "../modules/lab";
import { runCli, type CliSpec } from "../platform/cli";

import { cliDescriptions, parseLabEnvCheckArgs } from "./lab-env-check-args";

// The start guard of the sim stack (deploy/compose.sim.yaml): every container command runs it before its program.
// It prints only the issue codes, never a value of a key, on stdout (CI and the Compose command read stdout).
// Exit 0 = the env is the sim stack, 1 = it is not (or the corpus is missing).
const CORPUS_ROOT = resolve(import.meta.dir, "../../../../evals/sim");

const main: CliSpec["main"] = async (argv, out) => {
  parseLabEnvCheckArgs(argv);
  let corpus;
  try {
    corpus = await loadLabCorpus(CORPUS_ROOT, "lab-01");
  } catch {
    out.fail("the lab-01 corpus did not load");
    return 1;
  }
  const issues = checkSimEnv(process.env, labAddresses(corpus));
  if (issues.length === 0) {
    out.print("ok");
    return 0;
  }
  for (const issue of issues) out.print(issue);
  return 1;
};

if (import.meta.main) {
  await runCli({ prefix: "lab-env-check", descriptions: cliDescriptions, main });
}
