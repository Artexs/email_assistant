import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:password",
    summary: "Stores a new password for one mailbox and checks the login.",
    risk: "write",
    needs: ["db", "imap", "smtp"],
    usage: [
      "bun run mailbox:password --org-id <uuid> --mailbox-id <uuid> [--secret-kind password|app_password]",
      "  Example: read -rsp 'New password: ' P && printf '%s' \"$P\" | bun run mailbox:password --org-id <uuid> --mailbox-id <uuid>",
      "  --secret-kind default: keep the stored kind.",
      "  The password comes only from stdin, never from an argument. A terminal on stdin is refused.",
    ].join("\n"),
    exits: {
      1: "the password was not saved: refused stdin, a failed login, or an error",
      3: "the database or the mail server did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface MailboxPasswordArgs {
  orgId: string;
  mailboxId: string;
  secretKind: "password" | "app_password" | undefined;
}

// The option list is exported for the secrets test: no option carries a password (it comes from stdin).
export const mailboxPasswordOptions = {
  "org-id": { type: "string" },
  "mailbox-id": { type: "string" },
  "secret-kind": { type: "string" },
} as const;

const argsSchema = z.object({
  orgId: z.uuid(),
  mailboxId: z.uuid(),
  secretKind: z.enum(["password", "app_password"]).optional(),
});

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseMailboxPasswordArgs(argv: string[]): MailboxPasswordArgs {
  const { values } = parseFlags({ args: argv, options: mailboxPasswordOptions });
  const parsed = argsSchema.safeParse({
    orgId: values["org-id"],
    mailboxId: values["mailbox-id"],
    secretKind: values["secret-kind"],
  });
  if (!parsed.success) {
    throw new UsageError("--org-id and --mailbox-id are required uuids; --secret-kind is password or app_password");
  }
  return { ...parsed.data, secretKind: parsed.data.secretKind };
}
