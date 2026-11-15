import { parseArgs } from "node:util";

import { z } from "zod";

import { queueHistoryCheckByOperator } from "../modules/trust";
import { createCliOutput } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

const out = createCliOutput("trust-history-check");

const usage = [
  "usage: bun run trust:history-check --org-id <uuid> --mailbox-id <uuid>",
  "  Queues a history check (reason cli) for one mailbox. It reads no mail itself: the job trust.history runs the check.",
  "  Prints the check id and status. A check that is open already is printed, not repeated.",
  "  Exit 0: queued or already open. Exit 1: usage error, suspended organization (org_suspended), unknown mailbox or failure.",
].join("\n");

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" } },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    return { orgId, mailboxId };
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    out.fail(usage);
    return 1;
  }
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await queueHistoryCheckByOperator(db, { orgId: options.orgId }, options.mailboxId);
    if (result.kind === "org_suspended") {
      out.fail(`organization ${options.orgId} is suspended: org_suspended. Resume it with org:plan first.`);
      return 1;
    }
    if (result.kind === "mailbox_not_found") {
      out.fail(`mailbox ${options.mailboxId} not found in organization ${options.orgId}`);
      return 1;
    }
    out.print(
      `${result.kind === "queued" ? "queued" : "already open"}: check ${result.checkId}, status ${result.status}`
    );
    return 0;
  } catch (error) {
    out.fail(`failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    out.fail(`failed: ${describeError(error)}`);
    process.exit(1);
  });
