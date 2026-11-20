import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type CliSpec, runCli } from "../platform/cli";

import {
  cliDescriptions,
  claimedSlots,
  jobHash,
  parseE2eJobEnvArgs,
  pickPortSlot,
  portBlock,
} from "./e2e-job-env-args";

const exitDone = 0;
const exitFailure = 1;

function git(args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

// The `.env` text of every other worktree of this repository. A worktree with no readable `.env` adds nothing.
function otherWorktreeEnvTexts(): string[] {
  const listing = git(["worktree", "list", "--porcelain"]);
  const own = git(["rev-parse", "--show-toplevel"])?.trim();
  if (listing === null) return [];
  const texts: string[] = [];
  for (const line of listing.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    if (own !== undefined && resolve(path) === resolve(own)) continue;
    try {
      texts.push(readFileSync(`${path}/.env`, "utf8"));
    } catch {
      // No `.env` there: no claim.
    }
  }
  return texts;
}

// A bind test on the loopback address: `Bun.listen` throws when the port is in use and stops at once.
function canBind(port: number): boolean {
  try {
    Bun.listen({ hostname: "127.0.0.1", port, socket: { data: () => undefined } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

const main: CliSpec["main"] = async (argv, out) => {
  const { jobName } = parseE2eJobEnvArgs(argv);
  const hash = jobHash(jobName);
  const claimed = claimedSlots(otherWorktreeEnvTexts());
  const slot = pickPortSlot(hash, (candidate) => {
    if (claimed.has(candidate)) return true;
    const block = portBlock(candidate);
    return ![block.app, block.telegram, block.docs].every(canBind);
  });
  if (slot === null) {
    out.fail("no free e2e port block");
    return exitFailure;
  }
  const block = portBlock(slot);
  out.raw(`E2E_PORT=${block.app}`);
  out.raw(`E2E_TELEGRAM_PORT=${block.telegram}`);
  out.raw(`DOCS_TEST_PORT=${block.docs}`);
  out.raw(`E2E_MAIL_TAG=${hash}`);
  return exitDone;
};

if (import.meta.main) {
  await runCli({ prefix: "e2e-job-env", descriptions: cliDescriptions, main });
}
