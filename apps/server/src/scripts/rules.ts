import { parseArgs } from "node:util";

import { senderRuleKinds, type SenderRuleKind } from "@ea/core";
import { z } from "zod";

import { insertSenderRule, listSenderRules } from "../modules/config";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("rules");

const usage = [
  `usage: bun run rules:add --org-id <uuid> [--mailbox-id <uuid>] --pattern <address or domain> --kind ${senderRuleKinds.join("|")}`,
  "       bun run rules:list --org-id <uuid> [--mailbox-id <uuid>]",
].join("\n");

// No mailbox has this id: `listSenderRules` then returns the org-wide rules only.
const noMailboxId = "00000000-0000-0000-0000-000000000000";

// An address `local@domain` or a domain with a dot. A leading "@" or a domain without a dot never matches.
const domainPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const addressPattern = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function isValidPattern(pattern: string): boolean {
  return domainPattern.test(pattern) || addressPattern.test(pattern);
}

type Options =
  | { command: "add"; orgId: string; mailboxId: string | null; pattern: string; kind: SenderRuleKind }
  | { command: "list"; orgId: string; mailboxId: string | null };

function readOptions(): Options | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        pattern: { type: "string" },
        kind: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    const uuid = z.uuid();
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || !uuid.safeParse(orgId).success) return undefined;
    if (mailboxId !== undefined && !uuid.safeParse(mailboxId).success) return undefined;
    if (positionals.length !== 1) return undefined;

    if (positionals[0] === "list") {
      if (values.pattern !== undefined || values.kind !== undefined) return undefined;
      return { command: "list", orgId, mailboxId: mailboxId ?? null };
    }
    if (positionals[0] === "add") {
      const kind = z.enum(senderRuleKinds).safeParse(values.kind);
      if (!kind.success || values.pattern === undefined) return undefined;
      const pattern = values.pattern.trim().toLowerCase();
      if (!isValidPattern(pattern)) return undefined;
      return { command: "add", orgId, mailboxId: mailboxId ?? null, pattern, kind: kind.data };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// The rules are the user's own settings: they go to stdout for the user, not through `log`.
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: options.orgId };

    if (options.command === "add") {
      const inserted = await insertSenderRule(db, ctx, {
        mailboxId: options.mailboxId,
        pattern: options.pattern,
        kind: options.kind,
      });
      out(inserted ? `added ${options.kind} ${options.pattern}` : `already there: ${options.kind} ${options.pattern}`);
      return 0;
    }

    out(options.mailboxId ? `scope: org-wide + mailbox ${options.mailboxId}` : "scope: org-wide");
    const rules = await listSenderRules(db, ctx, options.mailboxId ?? noMailboxId);
    if (rules.length === 0) out("no rules");
    for (const rule of rules) out(`${rule.kind}\t${rule.pattern}`);
    return 0;
  } catch (error) {
    log.error("failed:", describeError(error));
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", describeError(error));
    process.exit(1);
  });
