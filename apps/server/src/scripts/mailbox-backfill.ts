import { DAY_MS } from "@ea/core";

import { isOwnMailOf } from "../composition";
import { backfillMailbox, CursorMovedError } from "../modules/mail";
import { requeueBackfillWindow } from "../modules/triage";
import { runCli, type CliSpec } from "../platform/cli";

import { backfillRefusal } from "./lib/mailbox-backfill-gate";
import { type CliDeps, oauthReasonLine, withMailboxDeps } from "./lib/mailbox-cli";
import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, type MailboxBackfillArgs, parseMailboxBackfillArgs } from "./mailbox-backfill-args";

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(options: MailboxBackfillArgs, deps: CliDeps): Promise<number> {
  const { db, out } = deps;
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
      return 1;
    }
    const reason = oauthReasonLine(error);
    if (reason !== null) {
      out.fail(reason);
      return 1;
    }
    return reportFailure(out, error, "label");
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
// Ctrl-C leaves the lock and the cursor as they are (no signal handler): the next run continues.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxBackfillArgs(argv);
  try {
    return await withMailboxDeps(out, (deps) => run(options, deps));
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-backfill", descriptions: cliDescriptions, main });
}
