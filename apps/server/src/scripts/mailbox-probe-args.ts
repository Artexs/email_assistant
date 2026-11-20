import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export type ProbeSub = "move" | "send";

export interface MailboxProbeMoveArgs {
  sub: "move";
  host: string;
  port: number;
  address: string;
}

export interface MailboxProbeSendArgs {
  sub: "send";
  host: string;
  port: number;
  address: string;
  smtpHost: string;
  smtpPort: number;
  to: string;
}

export type MailboxProbeArgs = MailboxProbeMoveArgs | MailboxProbeSendArgs;

export const cliDescriptions = [
  {
    name: "mailbox:probe-move",
    subcommand: "move",
    summary: "Tests move and folder calls on the test mailbox with one synthetic mail.",
    risk: "outside",
    needs: ["imap"],
    usage: [
      "bun run mailbox:probe-move --host <imap host> --port <port> --address <address>",
      "  Example: printf '%s' \"$PASSWORD\" | TEST_MAILBOX_ADDRESS=<address> bun run mailbox:probe-move --host <imap host> --port <port> --address <address>",
      "  It changes the mailbox: it adds one synthetic mail and creates the folder AI/Probe-… (and the parent AI, if missing).",
      "  If the server refuses nested folders, it creates a flat folder AI-Probe-… instead. It removes all of them at the end.",
      "  It refuses unless TEST_MAILBOX_ADDRESS equals --address. The password comes only from stdin.",
    ].join("\n"),
    exits: {
      1: "refused (not the test mailbox, or stdin is empty or a terminal) or the probe failed",
      3: "the mail server did not answer",
    },
  },
  {
    name: "mailbox:probe-send",
    subcommand: "send",
    summary: "Tests draft, send and Sent calls on the test mailbox with one real mail.",
    risk: "outside",
    needs: ["imap", "smtp"],
    usage: [
      "bun run mailbox:probe-send --host <imap host> --port <port> --smtp-host <host> --smtp-port <port> --address <address> --to <address>",
      "  Example: printf '%s' \"$PASSWORD\" | TEST_MAILBOX_ADDRESS=<address> SEND_TEST_ADDRESSES=<address,…> bun run mailbox:probe-send --host <imap host> …",
      "  It changes the mailbox and sends one real mail: it adds one synthetic draft, sends one mail from --address to --to,",
      "  adds one copy to Sent, waits for the mail in INBOX, and removes all of them by UID at the end.",
      "  It creates the folders Drafts and Sent if they are missing.",
      "  It refuses unless TEST_MAILBOX_ADDRESS equals --address, and --to equals --address or is in SEND_TEST_ADDRESSES.",
      "  The password comes only from stdin.",
    ].join("\n"),
    exits: {
      1: "refused (not a test address, or stdin is empty or a terminal) or the probe failed",
      3: "the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export function probeSubOf(argv: string[]): ProbeSub | undefined {
  const [sub] = argv;
  return sub === "move" || sub === "send" ? sub : undefined;
}

const portSchema = z.coerce.number().int().min(1).max(65_535);

// The option list is exported for the secrets test: no option carries the password (stdin does).
export const mailboxProbeOptions = {
  host: { type: "string" },
  port: { type: "string" },
  "smtp-host": { type: "string" },
  "smtp-port": { type: "string" },
  address: { type: "string" },
  to: { type: "string" },
} as const;

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxProbeArgs(argv: string[]): MailboxProbeArgs {
  const sub = probeSubOf(argv);
  if (sub === undefined) throw new UsageError("the first argument is move or send");
  const { values } = parseFlags({ args: argv.slice(1), options: mailboxProbeOptions });
  const port = portSchema.safeParse(values.port);
  if (values.host === undefined || values.address === undefined || !port.success) {
    throw new UsageError("--host, --port (1..65535) and --address are required");
  }
  const base = { host: values.host, port: port.data, address: values.address };
  const smtpHost = values["smtp-host"];
  if (sub === "move") {
    if (smtpHost !== undefined || values["smtp-port"] !== undefined || values.to !== undefined) {
      throw new UsageError("move takes no --smtp-host, --smtp-port or --to");
    }
    return { sub, ...base };
  }
  const smtpPort = portSchema.safeParse(values["smtp-port"]);
  if (smtpHost === undefined || values.to === undefined || !smtpPort.success) {
    throw new UsageError("send needs --smtp-host, --smtp-port (1..65535) and --to");
  }
  return { sub, ...base, smtpHost, smtpPort: smtpPort.data, to: values.to };
}
