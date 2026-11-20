import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createCliOutput } from "../platform/cli";

import { claimedSlots, jobHash, pickPortSlot, portBlock } from "./e2e-job-env-args";

const out = createCliOutput("e2e-job-env");

const usage = [
  "usage: bun apps/server/src/scripts/e2e-job-env.ts --job-name <date>-<hash>",
  "  Prints E2E_PORT, E2E_TELEGRAM_PORT, DOCS_TEST_PORT and E2E_MAIL_TAG for one job: a free block of three ports",
  "  (not named by another worktree's .env, and free to bind on 127.0.0.1) and the job hash. It takes no lock:",
  "  the caller holds one around this call and the write of the .env.",
  "  Exit 0: printed. Exit 1: no free e2e port block. Exit 2: bad arguments.",
].join("\n");

const exitDone = 0;
const exitFailure = 1;
const exitUsage = 2;

function parseJobName(argv: string[]): string | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { "job-name": { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    const name = values["job-name"];
    return positionals.length === 0 && name !== undefined && name !== "" ? name : null;
  } catch {
    return null;
  }
}

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

function main(): number {
  const jobName = parseJobName(process.argv.slice(2));
  if (jobName === null) {
    out.fail(usage);
    return exitUsage;
  }
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
}

process.exit(main());
