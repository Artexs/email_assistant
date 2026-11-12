import { parseArgs } from "node:util";

export const usage = [
  "usage:",
  "  bun run job:run --name actions.expiry|delegation.chaser|actions.committer|channels.notifier|platform.retention [--force]",
  "  --force: only with delegation.chaser; skips the 07:30 and once-per-day gate.",
  "  Do not run actions.committer while the server runs on the same database.",
  "  Exit 0: the job ran once. Exit 1: usage error or failure.",
].join("\n");

export const jobNames = [
  "actions.expiry",
  "delegation.chaser",
  "actions.committer",
  "channels.notifier",
  "platform.retention",
] as const;
export type JobName = (typeof jobNames)[number];

export interface JobRunArgs {
  name: JobName;
  force: boolean;
}

// Returns null on any bad argument; the script prints the usage.
export function parseJobRunArgs(argv: string[]): JobRunArgs | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { name: { type: "string" }, force: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const name = jobNames.find((candidate) => candidate === values.name);
    if (name === undefined || positionals.length > 0) return null;
    const force = values.force === true;
    if (force && name !== "delegation.chaser") return null;
    return { name, force };
  } catch {
    return null;
  }
}
