import { parseArgs } from "node:util";

import { BATCH_ID_PATTERN, type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

// `send` is the only command that talks to AgentMail and mails a real inbox. The others read and write the files of
// `evals/testmail/` (batches, personas, target, send logs in `~/.local/state/ea-testmail/`) and make no network call.
const FILES =
  "Files: evals/testmail/{batches/,personas.json,target.json}, logs and lock in ~/.local/state/ea-testmail/.";

export const cliDescriptions = [
  {
    name: "testmail:setup",
    subcommand: "setup",
    summary: "Finds or creates the AgentMail inbox of the persona file and prints its status.",
    risk: "outside",
    needs: ["agentmail"],
    usage: `bun run testmail:setup\n  ${FILES}`,
    exits: { 1: "the inbox address differs from the persona file, or AgentMail failed" },
  },
  {
    name: "testmail:validate",
    subcommand: "validate",
    summary: "Checks one test-mail batch against the persona file and prints the counts per category.",
    risk: "read",
    needs: ["none"],
    usage: `bun run testmail:validate --batch <id> [--allow-unlabelled]\n  ${FILES}`,
    exits: { 1: "the batch has issues, or a file is missing or bad" },
  },
  {
    name: "testmail:blind",
    subcommand: "blind",
    summary: "Prints the blind view of a batch, or applies the labels of a blind checker to it.",
    risk: "write",
    needs: ["none"],
    usage: `bun run testmail:blind --batch <id> [--apply <labels.json> --checker <model id>]\n  ${FILES}`,
    exits: { 1: "the labels name a case that is not in the batch, or a file is missing or bad" },
  },
  {
    name: "testmail:send",
    subcommand: "send",
    summary: "Sends the cases of one batch as real mail through AgentMail to TEST_MAILBOX_ADDRESS.",
    risk: "outside",
    needs: ["agentmail"],
    usage: [
      "bun run testmail:send --batch <id> [--limit n] [--interval-sec 30] [--daily-cap 50] [--dry-run]",
      "  Env: TEST_MAILBOX_ADDRESS=<address>. It must equal testAddress in evals/testmail/target.json; send refuses every other recipient.",
      `  ${FILES}`,
    ].join("\n"),
    exits: {
      1: "a case needs a fix, the batch is invalid, the recipient is refused, or a send failed",
      4: "stopped at a cap or a limit, or cases are left to send: run it again later",
    },
  },
  {
    name: "testmail:status",
    subcommand: "status",
    summary: "Prints the send state of each case of one batch from its send log.",
    risk: "read",
    needs: ["none"],
    usage: `bun run testmail:status --batch <id>\n  ${FILES}`,
    exits: { 1: "a file is missing or bad, or a send log is damaged" },
  },
] satisfies readonly CliDescription[];

const batchOption = z.string().regex(BATCH_ID_PATTERN);

const optionSchemas = {
  setup: z.object({}).strict(),
  validate: z.object({ batch: batchOption, "allow-unlabelled": z.boolean().default(false) }).strict(),
  blind: z
    .object({ batch: batchOption, apply: z.string().min(1).optional(), checker: z.string().min(1).max(80).optional() })
    .strict()
    .refine((options) => (options.apply === undefined) === (options.checker === undefined)),
  send: z
    .object({
      batch: batchOption,
      limit: z.coerce.number().int().min(0).optional(),
      "interval-sec": z.coerce.number().int().min(5).max(600).default(30),
      "daily-cap": z.coerce.number().int().min(1).max(95).default(50),
      "dry-run": z.boolean().default(false),
    })
    .strict(),
  status: z.object({ batch: batchOption }).strict(),
} as const;

export type TestmailCommand = keyof typeof optionSchemas;
export type TestmailOptions<C extends TestmailCommand> = z.infer<(typeof optionSchemas)[C]>;

export type TestmailArgs =
  | { command: "setup"; options: TestmailOptions<"setup"> }
  | { command: "validate"; options: TestmailOptions<"validate"> }
  | { command: "blind"; options: TestmailOptions<"blind"> }
  | { command: "send"; options: TestmailOptions<"send"> }
  | { command: "status"; options: TestmailOptions<"status"> };

const parseOptionTypes = {
  batch: { type: "string" },
  apply: { type: "string" },
  checker: { type: "string" },
  limit: { type: "string" },
  "interval-sec": { type: "string" },
  "daily-cap": { type: "string" },
  "allow-unlabelled": { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const;

function isCommand(name: string | undefined): name is TestmailCommand {
  return name !== undefined && Object.hasOwn(optionSchemas, name);
}

// "<path>: <issue code>" per issue: names the field and the kind of fault, never the value.
function issueLines(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`).join("; ");
}

/** The subcommand and its options. Throws `UsageError` (or a `parseArgs` error) on an unknown subcommand or a bad option. */
export function parseTestmailArgs(argv: string[]): TestmailArgs {
  const [command, ...rest] = argv;
  if (!isCommand(command))
    throw new UsageError("the first argument is a subcommand: setup, validate, blind, send or status");
  const { values } = parseArgs({ args: rest, options: parseOptionTypes, strict: true, allowPositionals: false });
  const parsed = optionSchemas[command].safeParse(values);
  if (!parsed.success) throw new UsageError(issueLines(parsed.error));
  return { command, options: parsed.data } as TestmailArgs;
}
