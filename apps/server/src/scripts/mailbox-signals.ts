import { DAY_MS } from "@ea/core";

import { signalsOfMailbox } from "../modules/mail";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { type CliDeps, oauthReasonLine, runMailboxCli } from "./lib/mailbox-cli";
import { readSignalsOptions, signalsLines, usage } from "./mailbox-signals-args";

const log = createLog("mailbox-signals");

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  const { out } = deps;
  const options = readSignalsOptions(argv);
  if (!options) {
    out.fail(usage);
    return 1;
  }
  try {
    const since = new Date(Date.now() - options.days * DAY_MS);
    const signals = await signalsOfMailbox(deps, { orgId: options.orgId }, options.mailboxId, since);
    // The figures are for the operator, not log lines.
    out.raw(signalsLines(signals).join("\n"));
    return 0;
  } catch (error) {
    log.error("mailbox_signals_failed", { ...errorFields(error) });
    const reason = oauthReasonLine(error);
    if (reason !== null) out.fail(reason);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await runMailboxCli("mailbox-signals", run));
}
