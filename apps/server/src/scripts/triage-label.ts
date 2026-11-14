import { parseArgs } from "node:util";

import type { Category } from "@ea/core";
import { z } from "zod";

import { listForLabeling, parseLabelInput, recordFeedback, type LabelItem } from "../modules/triage";
import { loadConfig, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("triage-label");

const usage = [
  "usage: bun run triage:label --org-id <uuid> --mailbox-id <uuid> [--limit 20] [--user-id <uuid>] [--synthetic]",
  "       bun run triage:label --org-id <uuid> --email-id <uuid> (--category <c> | --right | --wrong) [--user-id <uuid>]",
].join("\n");

const categoryOption = z.enum(["urgent", "needs_reply", "info", "notification", "spam"]);

type Options =
  | { mode: "interactive"; orgId: string; mailboxId: string; limit: number; userId?: string; synthetic: boolean }
  | {
      mode: "single";
      orgId: string;
      emailId: string;
      userId?: string;
      trueCategory?: Category;
      verdict?: "right" | "wrong";
    };

function readOptions(): Options | undefined {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        "email-id": { type: "string" },
        "user-id": { type: "string" },
        limit: { type: "string", default: "20" },
        category: { type: "string" },
        right: { type: "boolean", default: false },
        wrong: { type: "boolean", default: false },
        synthetic: { type: "boolean", default: false },
      },
      strict: true,
    });
    const uuid = z.uuid();
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    const emailId = values["email-id"];
    const userId = values["user-id"];
    if (orgId === undefined || !uuid.safeParse(orgId).success) return undefined;
    if (userId !== undefined && !uuid.safeParse(userId).success) return undefined;
    const base = userId === undefined ? {} : { userId };

    if (emailId !== undefined) {
      if (mailboxId !== undefined || !uuid.safeParse(emailId).success) return undefined;
      const choices = [values.category !== undefined, values.right, values.wrong].filter(Boolean).length;
      if (choices !== 1) return undefined;
      if (values.category !== undefined) {
        const category = categoryOption.safeParse(values.category);
        if (!category.success) return undefined;
        return { mode: "single", orgId, emailId, trueCategory: category.data, ...base };
      }
      return { mode: "single", orgId, emailId, verdict: values.right ? "right" : "wrong", ...base };
    }

    if (mailboxId === undefined || !uuid.safeParse(mailboxId).success) return undefined;
    if (values.category !== undefined || values.right || values.wrong) return undefined;
    const limit = z.coerce.number().int().min(1).max(1000).safeParse(values.limit);
    if (!limit.success) return undefined;
    return { mode: "interactive", orgId, mailboxId, limit: limit.data, synthetic: values.synthetic, ...base };
  } catch {
    return undefined;
  }
}

// Mail data goes to stdout for the user, never through `log` (log lines carry no mail data).
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function showItem(item: LabelItem, index: number, total: number): void {
  out("");
  out(`[${index}/${total}] ${item.emailId}`);
  out(`  received:   ${item.receivedAt.toISOString()}`);
  out(`  from:       ${item.from ?? "-"}`);
  out(`  subject:    ${item.subject ?? "-"}`);
  out(`  predicted:  ${item.category} (confidence ${item.confidence})`);
  out(`  model said: ${item.modelCategory ?? "-"}`);
  out(`  summary:    ${item.summary ?? "-"}`);
  out("  1 urgent, 2 needs_reply, 3 info, 4 notification, 5 spam; Enter = right, w = wrong, s = skip, q = quit");
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

    if (options.mode === "single") {
      const result = await recordFeedback(db, ctx, {
        emailId: options.emailId,
        trueCategory: options.trueCategory,
        verdict: options.verdict,
        source: "cli",
        userId: options.userId,
      });
      log.info(`feedback ${result.id} verdict ${result.verdict}`);
      return 0;
    }

    const items = await listForLabeling(db, ctx, options.mailboxId, {
      limit: options.limit,
      mail: options.synthetic ? "synthetic" : "real",
      testMail: testMailRule(config),
    });
    let labeled = 0;
    let skipped = 0;
    for (const [position, item] of items.entries()) {
      showItem(item, position + 1, items.length);
      let done = false;
      while (!done) {
        // prompt() returns null at the end of the input (Ctrl-D or a closed pipe): quit.
        const answer = prompt(">");
        const parsed = answer === null ? ({ kind: "quit" } as const) : parseLabelInput(answer, item.category);
        if (parsed.kind === "ask_again") {
          out(parsed.message);
        } else if (parsed.kind === "skip") {
          skipped += 1;
          done = true;
        } else if (parsed.kind === "quit") {
          log.info(`labeled ${labeled}, skipped ${skipped}`);
          return 0;
        } else {
          await recordFeedback(db, ctx, {
            emailId: item.emailId,
            ...(parsed.kind === "category" ? { trueCategory: parsed.category } : { verdict: parsed.kind }),
            source: "cli",
            userId: options.userId,
          });
          labeled += 1;
          done = true;
        }
      }
    }
    log.info(`labeled ${labeled}, skipped ${skipped}`);
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
