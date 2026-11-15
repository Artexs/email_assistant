import { resolve } from "node:path";

import { checkSimEnv } from "@ea/core";

import { labAddresses, loadLabCorpus } from "../modules/lab";
import { createCliOutput } from "../platform/cli";

// The start guard of the sim stack (deploy/compose.sim.yaml): every container command runs it before its program.
// It prints only the issue codes, never a value of a key. Exit 0 = the env is the sim stack, 1 = it is not (or the corpus is missing).
const out = createCliOutput("lab-env-check");

const CORPUS_ROOT = resolve(import.meta.dir, "../../../../evals/sim");

async function main(): Promise<number> {
  const corpus = await loadLabCorpus(CORPUS_ROOT, "lab-01");
  const issues = checkSimEnv(process.env, labAddresses(corpus));
  if (issues.length === 0) {
    out.print("ok");
    return 0;
  }
  for (const issue of issues) out.print(issue);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    out.fail("the lab-01 corpus did not load");
    process.exit(1);
  });
