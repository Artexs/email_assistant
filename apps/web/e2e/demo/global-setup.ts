import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { e2eEnv, repoRoot } from "../env";
import globalSetup from "../global-setup";
import { shotSource } from "../lib/shot-source";
import { DEMO_OWNER_FILE } from "../docs-shots/shots-dir";

// The flags that the steps of the script need (README.md, the spike table). The e2e seed turns them on for its own organizations; the
// demo organization has none on (the docs shots check that), so the recording turns on the ones its steps use, through the product CLI.
const DEMO_FLAGS = ["trust_ladder", "approvals_page", "delegation_pages"] as const;

// Runs after the web servers started (the server command migrates the demo database). The source decides the seed, as for the docs shots
// (`shotSource()`): the demo organization when its seed file is there, else the e2e seed. The run logs `demo_source e2e|demo` once.
export default function demoRecordSetup(): void {
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
  const { orgId } = JSON.parse(readFileSync(DEMO_OWNER_FILE, "utf8")) as { orgId: string };
  for (const flag of DEMO_FLAGS) {
    execFileSync("bun", ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", flag, "--on"], {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    });
  }
}
