import { parseArgs } from "node:util";

import { z } from "zod";

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

const moveUsage = [
  "usage: printf '%s' \"$PASSWORD\" | TEST_MAILBOX_ADDRESS=<address> bun run mailbox:probe-move --host <imap host> --port <port> --address <address>",
  "  It changes the mailbox: it adds one synthetic mail and creates the folder AI/Probe-… (and the parent AI, if missing).",
  "  If the server refuses nested folders, it creates a flat folder AI-Probe-… instead. It removes all of them at the end.",
  "  It refuses unless TEST_MAILBOX_ADDRESS equals --address. The password comes only from stdin.",
].join("\n");

const sendUsage = [
  "usage: printf '%s' \"$PASSWORD\" | TEST_MAILBOX_ADDRESS=<address> SEND_TEST_ADDRESSES=<address,…> bun run mailbox:probe-send --host <imap host> --port <port> --smtp-host <host> --smtp-port <port> --address <address> --to <address>",
  "  It changes the mailbox and sends one real mail: it adds one synthetic draft, sends one mail from --address to --to,",
  "  adds one copy to Sent, waits for the mail in INBOX, and removes all of them by UID at the end.",
  "  It creates the folders Drafts and Sent if they are missing.",
  "  It refuses unless TEST_MAILBOX_ADDRESS equals --address, and --to equals --address or is in SEND_TEST_ADDRESSES.",
  "  The password comes only from stdin.",
].join("\n");

/** The usage of one subcommand, or of both when the subcommand is missing or unknown. */
export function probeUsage(sub: ProbeSub | undefined): string {
  if (sub === "move") return moveUsage;
  if (sub === "send") return sendUsage;
  return `usage: mailbox-probe <move|send> …\n${moveUsage}\n${sendUsage}`;
}

export function probeSubOf(argv: string[]): ProbeSub | undefined {
  const [sub] = argv;
  return sub === "move" || sub === "send" ? sub : undefined;
}

const portSchema = z.coerce.number().int().min(1).max(65_535);

// Returns null on any bad argument; the script prints the usage.
export function parseMailboxProbeArgs(argv: string[]): MailboxProbeArgs | null {
  const sub = probeSubOf(argv);
  if (sub === undefined) return null;
  try {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        host: { type: "string" },
        port: { type: "string" },
        "smtp-host": { type: "string" },
        "smtp-port": { type: "string" },
        address: { type: "string" },
        to: { type: "string" },
      },
      strict: true,
    });
    const port = portSchema.safeParse(values.port);
    if (values.host === undefined || values.address === undefined || !port.success) return null;
    const base = { host: values.host, port: port.data, address: values.address };
    const smtpHost = values["smtp-host"];
    if (sub === "move") {
      if (smtpHost !== undefined || values["smtp-port"] !== undefined || values.to !== undefined) return null;
      return { sub, ...base };
    }
    const smtpPort = portSchema.safeParse(values["smtp-port"]);
    if (smtpHost === undefined || values.to === undefined || !smtpPort.success) return null;
    return { sub, ...base, smtpHost, smtpPort: smtpPort.data, to: values.to };
  } catch {
    return null;
  }
}
