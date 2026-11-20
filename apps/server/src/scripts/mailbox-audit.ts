import { format, parseArgs } from "node:util";

import { z } from "zod";

import { auditExitCode, auditMailbox } from "../modules/mail";

import { type CliDeps, oauthReasonLine, runMailboxCli } from "./lib/mailbox-cli";

const usage = [
  "usage: bun run mailbox:audit --org-id <uuid> --mailbox-id <uuid> --since <ISO time>",
  "  Read-only. Run it right after a sync: mail from the last sync interval (MAIL_SYNC_EVERY_MIN, default 2 minutes) can show as missing.",
  "  Checks INBOX and every other enabled synced folder. cross = mail that has a row in another synced folder (not lost).",
  "  Exit 0: no difference in INBOX. Exit 2: lost or duplicate INBOX mail. Exit 1: error. cross never changes the code.",
].join("\n");

function readOptions(argv: string[]) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        since: { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    const sinceText = values.since;
    if (orgId === undefined || mailboxId === undefined || sinceText === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const since = new Date(sinceText);
    if (Number.isNaN(since.getTime())) return undefined;
    return { orgId, mailboxId, since };
  } catch {
    return undefined;
  }
}

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  const { out } = deps;
  const options = readOptions(argv);
  if (!options) {
    out.fail(usage);
    return 1;
  }
  try {
    const results = await auditMailbox(deps, { orgId: options.orgId }, options.mailboxId, options.since);
    for (const { key, counts } of results) {
      if (counts === null) {
        out.print(`folder=${key} not on the server`);
      } else if (key === "inbox") {
        out.print(
          `inbox=${counts.mail} stored=${counts.stored} missing=${counts.missing} duplicates=${counts.duplicates} cross=${counts.cross}`
        );
      } else {
        out.print(
          `folder=${key} mail=${counts.mail} stored=${counts.stored} missing=${counts.missing} duplicates=${counts.duplicates} cross=${counts.cross}`
        );
      }
    }
    return auditExitCode(results.find((result) => result.key === "inbox")?.counts);
  } catch (error) {
    out.fail(oauthReasonLine(error) ?? `failed: ${error instanceof Error ? error.message : format(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await runMailboxCli("mailbox-audit", run));
}
