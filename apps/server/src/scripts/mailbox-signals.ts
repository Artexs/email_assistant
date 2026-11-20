import { DAY_MS, EXIT } from "@ea/core";

import { signalsOfMailbox } from "../modules/mail";
import { exitCodeOf, runCli, type CliSpec } from "../platform/cli";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { type CliDeps, oauthReasonLine, withMailboxDeps } from "./lib/mailbox-cli";
import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, parseMailboxSignalsArgs, type SignalsOptions, signalsLines } from "./mailbox-signals-args";

const log = createLog("mailbox-signals");

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(options: SignalsOptions, deps: CliDeps): Promise<number> {
  const { out } = deps;
  try {
    const since = new Date(Date.now() - options.days * DAY_MS);
    const signals = await signalsOfMailbox(deps, { orgId: options.orgId }, options.mailboxId, since);
    // The figures are for the operator, not log lines.
    out.raw(signalsLines(signals).join("\n"));
    return 0;
  } catch (error) {
    log.error("mailbox_signals_failed", { ...errorFields(error) });
    const reason = oauthReasonLine(error);
    if (reason !== null) {
      out.fail(reason);
      return 1;
    }
    // The event line above is the failure record; only an unreachable system gets the standard text line (docs/cli.md).
    const code = exitCodeOf(error);
    if (code === EXIT.unreachable) reportFailure(out, error, "label");
    return code;
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxSignalsArgs(argv);
  try {
    return await withMailboxDeps(out, (deps) => run(options, deps));
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-signals", descriptions: cliDescriptions, main });
}
