import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "job:run",
    summary: "Runs one background job once with the deps of the server.",
    risk: "write",
    needs: ["db", "imap", "smtp", "telegram", "llm"],
    usage: [
      "bun run job:run --name actions.expiry|loops.chaser|delegation.chaser|actions.committer|channels.notifier|platform.retention|loops.analyze|loops.match|contacts.refresh|replies.drafter|replies.sweep [--force]",
      "  --force: only with loops.chaser (or its alias delegation.chaser); skips the 07:30 and once-per-day gate.",
      "  delegation.chaser is an alias of loops.chaser: the one chaser runs both parts.",
      "  replies.drafter needs TRIAGE_LLM_SCOPE on: it calls the model (a real LLM call when a key is set).",
      "  replies.sweep reads the database only: it needs no model.",
      "  contacts.refresh recomputes the sender profiles of every active mailbox with the flag sender_context on; it needs no model and prints counts only.",
      "  Do not run actions.committer while the server runs on the same database.",
    ].join("\n"),
    exits: { 1: "the job failed for at least one mailbox, or was refused (no bot token, model scope off)" },
  },
] satisfies readonly CliDescription[];

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

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseJobRunArgs(argv: string[]): JobRunArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { name: { type: "string" }, force: { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
  const name = jobNames.find((candidate) => candidate === values.name);
  if (name === undefined) throw new UsageError("--name is a job name");
  if (positionals.length > 0) throw new UsageError("the job name goes after --name");
  const force = values.force === true;
  if (force && name !== "loops.chaser" && name !== "delegation.chaser") {
    throw new UsageError("--force is only for loops.chaser and delegation.chaser");
  }
  return { name, force };
}
