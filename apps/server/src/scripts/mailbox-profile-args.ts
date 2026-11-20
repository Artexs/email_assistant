import { type CliDescription, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "mailbox:profile",
    summary: "Shows or sets the display name, signature and writing style of one mailbox.",
    risk: "write",
    needs: ["db"],
    usage: [
      "bun run mailbox:profile --org-id <uuid> --mailbox-id <uuid>",
      "  [--display-name <text>] [--signature-file <path>] [--style-file <path>]",
      "  No change flag: print the profile (the stored values and the fallbacks).",
      "  An empty name or an empty file clears the field: the fallback applies.",
    ].join("\n"),
    exits: {
      1: "a refused text, an unreadable file, an unknown mailbox or a failure",
      3: "the database did not answer",
    },
  },
] satisfies readonly CliDescription[];

export interface ProfileCommand {
  orgId: string;
  mailboxId: string;
  displayName?: string;
  signatureFile?: string;
  styleFile?: string;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseProfileArgs(argv: string[]): ProfileCommand {
  try {
    const { values, positionals } = parseFlags({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        "display-name": { type: "string" },
        "signature-file": { type: "string" },
        "style-file": { type: "string" },
      },
      allowPositionals: true,
    });
    if (positionals.length > 0) throw new UsageError("no operand");
    const ids = z.object({ orgId: z.uuid(), mailboxId: z.uuid() }).parse({
      orgId: values["org-id"],
      mailboxId: values["mailbox-id"],
    });
    const file = z.string().min(1);
    return {
      ...ids,
      ...(values["display-name"] === undefined ? {} : { displayName: values["display-name"] }),
      ...(values["signature-file"] === undefined ? {} : { signatureFile: file.parse(values["signature-file"]) }),
      ...(values["style-file"] === undefined ? {} : { styleFile: file.parse(values["style-file"]) }),
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new UsageError(`bad or missing argument: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    }
    throw error;
  }
}
