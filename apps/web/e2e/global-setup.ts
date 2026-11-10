import { execFileSync } from "node:child_process";

import { e2eEnv, repoRoot } from "./env";

// Runs once per `bun run test:e2e`: the e2e schema is current, then the fixed organization and fresh setup links exist.
export default function globalSetup(): void {
  const env = e2eEnv();
  execFileSync("bun", ["run", "db:migrate"], { cwd: repoRoot, env, stdio: "inherit" });
  execFileSync("bun", ["apps/server/src/scripts/e2e-seed.ts"], { cwd: repoRoot, env, stdio: "inherit" });
}
