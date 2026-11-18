import { parseArgs } from "node:util";

import { z } from "zod";

export const usage = [
  "usage: bun run mailbox:profile --org-id <uuid> --mailbox-id <uuid>",
  "  [--display-name <text>] [--signature-file <path>] [--style-file <path>]",
  "  No change flag: print the profile (the stored values and the fallbacks).",
  "  An empty name or an empty file clears the field: the fallback applies.",
  "  Exit 0: ok. Exit 1: usage error, a refused text or a failure.",
].join("\n");

export interface ProfileCommand {
  orgId: string;
  mailboxId: string;
  displayName?: string;
  signatureFile?: string;
  styleFile?: string;
}

// Returns undefined on any bad argument; the script prints the usage.
export function parseProfileArgs(argv: string[]): ProfileCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        "display-name": { type: "string" },
        "signature-file": { type: "string" },
        "style-file": { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > 0) return undefined;
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
  } catch {
    return undefined;
  }
}
