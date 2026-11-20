import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:connect",
    summary: "Connects one mailbox to an organization after a test login.",
    risk: "write",
    needs: ["db", "imap", "smtp"],
    usage: [
      "bun run mailbox:connect --org-id <uuid> --address <email>",
      "  Example: read -rs P && printf '%s' \"$P\" | bun run mailbox:connect --org-id <uuid> --address <email>",
      "  [--secret-kind password|app_password (default password)]",
      "  [--imap-host poczta.interia.pl] [--imap-port 993] [--smtp-host poczta.interia.pl] [--smtp-port 465]",
      "  [--smtp-security tls|starttls (default tls; starttls is for SMTP port 587)]",
      "  The password comes only from stdin, never from an argument. A terminal on stdin is refused.",
    ].join("\n"),
    exits: {
      1: "the mailbox was not connected: refused stdin, a failed login, a limit, a duplicate or an error",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface MailboxConnectArgs {
  orgId: string;
  address: string;
  secretKind: "password" | "app_password";
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
}

// The option list is exported for the secrets test: `secret-kind` names a kind, no option carries the password (stdin does).
export const mailboxConnectOptions = {
  "org-id": { type: "string" },
  address: { type: "string" },
  "secret-kind": { type: "string", default: "password" },
  "imap-host": { type: "string", default: "poczta.interia.pl" },
  "imap-port": { type: "string", default: "993" },
  "smtp-host": { type: "string", default: "poczta.interia.pl" },
  "smtp-port": { type: "string", default: "465" },
  "smtp-security": { type: "string", default: "tls" },
} as const;

const port = z.coerce.number().int().min(1).max(65_535);

const argsSchema = z.object({
  orgId: z.uuid(),
  address: z.string().min(1),
  secretKind: z.enum(["password", "app_password"]),
  imapHost: z.string().min(1),
  imapPort: port,
  smtpHost: z.string().min(1),
  smtpPort: port,
  smtpSecurity: z.enum(["tls", "starttls"]),
});

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument. The address is
// checked by the service (`connectMailbox`), so a bad address keeps its `invalid input: address` line.
export function parseMailboxConnectArgs(argv: string[]): MailboxConnectArgs {
  const { values } = parseFlags({ args: argv, options: mailboxConnectOptions });
  const parsed = argsSchema.safeParse({
    orgId: values["org-id"],
    address: values.address,
    secretKind: values["secret-kind"],
    imapHost: values["imap-host"],
    imapPort: values["imap-port"],
    smtpHost: values["smtp-host"],
    smtpPort: values["smtp-port"],
    smtpSecurity: values["smtp-security"],
  });
  if (!parsed.success) {
    throw new UsageError(
      `bad or missing argument: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  }
  return parsed.data;
}
