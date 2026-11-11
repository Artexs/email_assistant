import { parseArgs } from "node:util";

import {
  isValidSenderPattern,
  normalizeSenderPattern,
  SENDER_RULE_LIMIT,
  senderRuleKinds,
  type SenderRuleKind,
} from "@ea/core";
import { z } from "zod";

import { addSenderRule, listSenderRules } from "../modules/config";
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
      const pattern = normalizeSenderPattern(values.pattern);
      if (!isValidSenderPattern(pattern)) return undefined;
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
      const result = await addSenderRule(db, ctx, {
        mailboxId: options.mailboxId,
        pattern: options.pattern,
        kind: options.kind,
        actor: "cli",
        now: new Date(),
      });
      if (result.kind === "added") out(`added ${options.kind} ${options.pattern}`);
      if (result.kind === "exists") out(`already there: ${options.kind} ${options.pattern}`);
      if (result.kind === "limit") {
        log.error(`refused: rule limit reached (${SENDER_RULE_LIMIT})`);
        return 1;
      }
      if (result.kind === "mailbox_not_found") {
        log.error("refused: mailbox not found");
        return 1;
      }
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
