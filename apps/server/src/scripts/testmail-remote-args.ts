import { parseArgs } from "node:util";

import { BATCH_ID_PATTERN, type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

export const cliDescriptions = [
  {
    name: "testmail:remote",
    summary: "Runs testmail:target on the VPS for one batch: it delivers the test mail or compares its triage.",
    risk: "outside",
    needs: ["vps", "git"],
    usage: [
      "bun run testmail:remote deliver --batch <id> [--check-only] [--dry-run] [--print-input]",
      "bun run testmail:remote compare --batch <id> [--bar 0.98] [--min-kept 30] [--out <file.md>] [--dry-run] [--print-input]",
      "  It bundles testmail-target from a clean worktree of origin/master, copies it to the VPS of evals/testmail/target.json,",
      "  and runs it in a one-off server container. The exit code is the remote exit code (1 on a git, build, scp or ssh error).",
      '  On this PC set GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" for the git fetch.',
    ].join("\n"),
    exits: {
      1: "nothing sent yet, a git, build, scp or ssh error, an env value in the bundle, or remote exit 1",
      4: "the remote exit 4: some cases are not found or not triaged yet. Run it again later",
    },
  },
] satisfies readonly CliDescription[];

const optionSchema = z
  .object({
    batch: z.string().regex(BATCH_ID_PATTERN),
    "check-only": z.boolean().default(false),
    "dry-run": z.boolean().default(false),
    "print-input": z.boolean().default(false),
    bar: z.coerce.number().gt(0).max(1).optional(),
    "min-kept": z.coerce.number().int().min(1).max(10000).optional(),
    out: z.string().min(1).optional(),
  })
  .strict();

export type RemoteOptions = z.infer<typeof optionSchema>;

export interface TestmailRemoteArgs {
  command: "deliver" | "compare";
  options: RemoteOptions;
}

/** `deliver` or `compare` and its options. Throws `UsageError` (or a `parseArgs` error) on a bad argument. */
export function parseTestmailRemoteArgs(argv: string[]): TestmailRemoteArgs {
  const [command, ...rest] = argv;
  if (command !== "deliver" && command !== "compare") throw new UsageError("the first argument is deliver or compare");
  const { values } = parseArgs({
    args: rest,
    options: {
      batch: { type: "string" },
      "check-only": { type: "boolean" },
      "dry-run": { type: "boolean" },
      "print-input": { type: "boolean" },
      bar: { type: "string" },
      "min-kept": { type: "string" },
      out: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  const parsed = optionSchema.safeParse(values);
  if (!parsed.success) {
    throw new UsageError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`).join("; ")
    );
  }
  const options = parsed.data;
  if (
    command === "deliver" &&
    (options.bar !== undefined || options["min-kept"] !== undefined || options.out !== undefined)
  ) {
    throw new UsageError("--bar, --min-kept and --out are for compare only");
  }
  if (command === "compare" && options["check-only"]) throw new UsageError("--check-only is for deliver only");
  return { command, options };
}
