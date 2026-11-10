import { execFileSync } from "node:child_process";

import { e2eEnv, repoRoot } from "./env";

// Runs once per `bun run test:e2e`, after the web server (whose command runs `db:migrate`): the fixed organization and fresh setup links.
export default function globalSetup(): void {
  const env = e2eEnv();
  execFileSync("bun", ["apps/server/src/scripts/e2e-seed.ts"], { cwd: repoRoot, env, stdio: "inherit" });
}
