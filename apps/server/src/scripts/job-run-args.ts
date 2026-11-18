import { parseArgs } from "node:util";

export const usage = [
  "usage:",
  "  bun run job:run --name actions.expiry|loops.chaser|delegation.chaser|actions.committer|channels.notifier|platform.retention|loops.analyze|loops.match|contacts.refresh|replies.drafter|replies.sweep [--force]",
  "  --force: only with loops.chaser (or its alias delegation.chaser); skips the 07:30 and once-per-day gate.",
  "  delegation.chaser is an alias of loops.chaser: the one chaser runs both parts.",
  "  replies.drafter needs TRIAGE_LLM_SCOPE on: it calls the model (a real LLM call when a key is set).",
  "  replies.sweep reads the database only: it needs no model.",
  "  contacts.refresh recomputes the sender profiles of every active mailbox with the flag sender_context on; it needs no model and prints counts only.",
  "  Do not run actions.committer while the server runs on the same database.",
  "  Exit 0: the job ran once. Exit 1: usage error or failure.",
].join("\n");

export const jobNames = [
  "actions.expiry",
  "loops.chaser",
  "delegation.chaser",
  "actions.committer",
  "channels.notifier",
  "platform.retention",
  "loops.analyze",
  "loops.match",
  "contacts.refresh",
  "replies.drafter",
  "replies.sweep",
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
    if (force && name !== "loops.chaser" && name !== "delegation.chaser") return null;
    return { name, force };
  } catch {
    return null;
  }
}
