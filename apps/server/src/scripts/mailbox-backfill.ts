import { parseArgs } from "node:util";

import { DAY_MS } from "@ea/core";
import { z } from "zod";

import { isOwnMailOf } from "../composition";
import { backfillMailbox, CursorMovedError } from "../modules/mail";
import { requeueBackfillWindow } from "../modules/triage";
import { describeError } from "../platform/errors";

import { backfillRefusal } from "./lib/mailbox-backfill-gate";
import { type CliDeps, oauthReasonLine, runMailboxCli } from "./lib/mailbox-cli";

const usage = [
  "usage: bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 30]",
  "  One-off, read-only on the mailbox. Stores INBOX mail of the last 1-180 days that the sync missed.",
  "  Then re-queues stored real mail of that window that the worker skipped as too old.",
  "  Exit 0: done. Exit 1: usage error, suspended organization (org_suspended) or failure.",
].join("\n");

function readOptions(argv: string[]) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        days: { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || mailboxId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(mailboxId).success) return undefined;
    const days = z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(180))
      .safeParse(values.days ?? "30");
    if (!days.success) return undefined;
    return { orgId, mailboxId, days: days.data };
  } catch {
    return undefined;
  }
}

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  const { db, out } = deps;
  const options = readOptions(argv);
  if (!options) {
    out.fail(usage);
    return 1;
  }
  try {
    const refusal = await backfillRefusal(db, options.orgId);
    if (refusal !== undefined) {
      out.fail(refusal);
      return 1;
    }
    const now = new Date();
    const result = await backfillMailbox(
      { ...deps, isOwnActionId: isOwnMailOf(db) },
      { orgId: options.orgId },
      options.mailboxId,
      {
        days: options.days,
        now,
      }
    );
    out.print(
      `backfill ${options.mailboxId}: fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}`
    );
    const since = new Date(now.getTime() - options.days * DAY_MS);
    const requeued = await requeueBackfillWindow(db, { orgId: options.orgId }, options.mailboxId, { since, now });
    out.print(`re-queued ${requeued}`);
    return 0;
  } catch (error) {
    if (error instanceof CursorMovedError) {
      out.fail(
        "the regular sync moved the cursor during the backfill; run the same command again (the dedup key stops duplicates)"
      );
    } else {
      out.fail(oauthReasonLine(error) ?? `failed: ${describeError(error)}`);
    }
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await runMailboxCli("mailbox-backfill", run));
}
