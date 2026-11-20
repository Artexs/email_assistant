import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "e2e:job-env",
    summary: "Prints the e2e ports and the mail tag for one job, from a free block of three ports.",
    risk: "dev",
    needs: ["none"],
    usage: [
      "bun run e2e:job-env --job-name <date>-<hash>",
      "  Prints E2E_PORT, E2E_TELEGRAM_PORT, DOCS_TEST_PORT and E2E_MAIL_TAG for one job: a free block of three ports",
      "  (not named by another worktree's .env, and free to bind on 127.0.0.1) and the job hash. It takes no lock:",
      "  the caller holds one around this call and the write of the .env.",
    ].join("\n"),
    exits: { 1: "no free e2e port block" },
  },
] satisfies readonly CliDescription[];

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseE2eJobEnvArgs(argv: string[]): { jobName: string } {
  const { values } = parseArgs({
    args: argv,
    options: { "job-name": { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  const jobName = values["job-name"];
  if (jobName === undefined || jobName === "") throw new UsageError("--job-name is needed");
  return { jobName };
}

// The port contract of the Playwright suites. One pure place parses the keys, so the panel suite, the docs suite,
// the job prepare script and their tests share one rule. Unset or empty keeps the fixed port of a main checkout and CI.
export const E2E_DEFAULT_PORTS = { app: 8081, telegram: 8092, docs: 8093 } as const;

const PORT_MIN = 1024;
const PORT_MAX = 65535;

export function portFromEnv(value: string | undefined, key: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`${key} must be an integer from ${PORT_MIN} to ${PORT_MAX}`);
  }
  return port;
}

// The two ports of the panel suite: the web server and the fake Telegram. They must differ.
export function e2ePorts(env: Record<string, string | undefined>): { app: number; telegram: number } {
  const app = portFromEnv(env.E2E_PORT, "E2E_PORT", E2E_DEFAULT_PORTS.app);
  const telegram = portFromEnv(env.E2E_TELEGRAM_PORT, "E2E_TELEGRAM_PORT", E2E_DEFAULT_PORTS.telegram);
  if (app === telegram) throw new Error(`E2E_PORT and E2E_TELEGRAM_PORT must differ (both are ${app})`);
  return { app, telegram };
}

export function docsTestPort(env: Record<string, string | undefined>): number {
  return portFromEnv(env.DOCS_TEST_PORT, "DOCS_TEST_PORT", E2E_DEFAULT_PORTS.docs);
}

// Playwright runs on Node, which loads no `.env` by itself. A key that is already set keeps its value (`process.loadEnvFile`).
// A CI run has no file and gets the keys from the job.
export function loadRepoDotEnv(repoRoot: string): void {
  const path = `${repoRoot}/.env`;
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // An unreadable file is not fatal: the keys can also come from the real environment.
  }
}

// A job gets a block of three ports: the web server, the fake Telegram and the docs server. Slot `s` (0–999) starts at
// `20000 + 10·s`. The range is free of the OS ephemeral ports and of the fixed ports of a main checkout.
const BLOCK_BASE = 20000;
const BLOCK_STRIDE = 10;
export const PORT_SLOTS = 1000;

export function portBlock(slot: number): { app: number; telegram: number; docs: number } {
  const app = BLOCK_BASE + BLOCK_STRIDE * slot;
  return { app, telegram: app + 1, docs: app + 2 };
}

// The job name is `<date>-<hash>`. The tail after the last `-` is the hash when it is 1–16 hex characters. Any other
// name gets the first 8 hex characters of its SHA-1, so the slot and the mail tag stay stable for that name.
export function jobHash(jobName: string): string {
  const tail = jobName.slice(jobName.lastIndexOf("-") + 1);
  if (/^[0-9a-f]{1,16}$/i.test(tail)) return tail.toLowerCase();
  return createHash("sha1").update(jobName).digest("hex").slice(0, 8);
}

export function firstSlot(hash: string): number {
  if (!/^[0-9a-f]{1,16}$/i.test(hash)) throw new Error(`hash must be 1 to 16 hex characters: ${hash}`);
  return Number(BigInt(`0x${hash}`) % BigInt(PORT_SLOTS));
}

// Probes linearly from the first slot and wraps after the last one. `null` means that every slot is taken.
export function pickPortSlot(hash: string, isTaken: (slot: number) => boolean): number | null {
  const start = firstSlot(hash);
  for (let step = 0; step < PORT_SLOTS; step += 1) {
    const slot = (start + step) % PORT_SLOTS;
    if (!isTaken(slot)) return slot;
  }
  return null;
}

// Reads only `E2E_PORT=` lines of other worktrees' `.env` files. No other line is kept, so no secret leaves the function.
export function claimedSlots(envTexts: string[]): Set<number> {
  const slots = new Set<number>();
  for (const text of envTexts) {
    for (const line of text.split("\n")) {
      const match = /^E2E_PORT=["']?(\d+)["']?\s*$/.exec(line.replace(/\r$/, ""));
      if (match === null || match[1] === undefined) continue;
      const offset = Number(match[1]) - BLOCK_BASE;
      if (offset >= 0 && offset % BLOCK_STRIDE === 0 && offset / BLOCK_STRIDE < PORT_SLOTS) {
        slots.add(offset / BLOCK_STRIDE);
      }
    }
  }
  return slots;
}
