import { execFileSync } from "node:child_process";

import { e2eEnv, repoRoot } from "../env";
import globalSetup from "../global-setup";
import { shotSource } from "../lib/shot-source";
import { DEMO_OWNER_FILE } from "../docs-shots/shots-dir";
import { readDemoPlan } from "../lib/demo/setup";
import { readDemoOwner, runDemoSetup } from "./setup-run";

// Runs after the web servers started (the server command migrates the demo database). The source decides the seed, as for the docs shots
// (`shotSource()`): the demo organization when its seed file is there, else the e2e seed. The run logs `demo_source e2e|demo` once.
// The demo organization is then made ready (`runDemoSetup`: flags, mailbox A quiet, the owner on the fake Telegram, mailbox B with the
// history mail). The e2e seed turns its flags on for its own organizations; the demo organization has none on (the docs shots check that).
export default async function demoRecordSetup(): Promise<void> {
  const source = shotSource();
  // eslint-disable-next-line no-console
  console.log(`demo_source ${source.kind}`);
  if (source.kind === "e2e") {
    globalSetup();
    return;
  }
  const env = e2eEnv();
  execFileSync("bun", ["apps/server/src/scripts/demo-org-setup.ts", "--seed", source.file, "--out", DEMO_OWNER_FILE], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  const planFile = process.env.DEMO_PLAN_FILE ?? "";
  if (planFile === "") throw new Error("demo_replay_missing: run bun run demo:record");
  await runDemoSetup(readDemoPlan(planFile), readDemoOwner(DEMO_OWNER_FILE));
}
