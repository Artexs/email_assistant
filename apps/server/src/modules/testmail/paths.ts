import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface TestmailPaths {
  batchesDir: string;
  personasFile: string;
  targetFile: string;
  runsDir: string;
  lockFile: string;
  batchLog(id: string): string;
}

export function testmailPaths(env: Record<string, string | undefined> = process.env): TestmailPaths {
  const testRoot = env.TESTMAIL_ROOT;
  if (testRoot && !isAbsolute(testRoot)) throw new Error("TESTMAIL_ROOT must be an absolute path");
  const root = testRoot ? testRoot : resolve(import.meta.dir, "../../../../..");
  const runsDir = testRoot ? join(root, "evals/.runs/testmail") : join(homedir(), ".local/state/ea-testmail");
  return {
    batchesDir: join(root, "evals/testmail/batches"),
    personasFile: join(root, "evals/testmail/personas.json"),
    targetFile: join(root, "evals/testmail/target.json"),
    runsDir,
    lockFile: join(runsDir, "send.lock"),
    batchLog: (id) => join(runsDir, `${id}.jsonl`),
  };
}
