import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";

import { e2eEnv, repoRoot } from "../env";
import globalSetup from "../global-setup";
import { shotSource } from "../lib/shot-source";
import { DEMO_OWNER_FILE, SHOTS_DIR } from "./shots-dir";

// Empties the shot folder (a PNG of an older list must not stay), then seeds. The source decides the seed (`shotSource()`): the demo
// organization when its seed file is there (imported by `demo-org-setup.ts`, a command like the e2e seed), else the e2e seed
// as the panel run does. The run logs `shots_source demo|e2e` once.
export default function docsShotsSetup(): void {
  const source = shotSource();
  // eslint-disable-next-line no-console
  console.log(`shots_source ${source.kind}`);
  mkdirSync(SHOTS_DIR, { recursive: true });
  for (const file of readdirSync(SHOTS_DIR)) {
    if (file.endsWith(".png")) rmSync(`${SHOTS_DIR}/${file}`);
  }
  if (source.kind === "e2e") {
    globalSetup();
    return;
  }
  execFileSync("bun", ["apps/server/src/scripts/demo-org-setup.ts", "--seed", source.file, "--out", DEMO_OWNER_FILE], {
    cwd: repoRoot,
    env: e2eEnv(),
    stdio: "inherit",
  });
}
