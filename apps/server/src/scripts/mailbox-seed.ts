import { selectCases } from "@ea/core";

import { seedMailbox, type SeedMessage } from "../modules/mail";
import { runCli, type CliSpec } from "../platform/cli";

import { type CliDeps, oauthReasonLine, withMailboxDeps } from "./lib/mailbox-cli";
import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, loadCases, parseMailboxSeedArgs, type SeedOptions, toSeedMessage } from "./mailbox-seed-args";

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(options: SeedOptions, deps: CliDeps): Promise<number> {
  const { out } = deps;
  try {
    // `seedMailbox` checks the guards (test mailbox, real provider needs --from-owner) before any connection.
    let messages: SeedMessage[] | undefined;
    if (options.evalSet !== undefined) {
      const files = options.evalSet === "all" ? ["synthetic", "injection", "delegation"] : [options.evalSet];
      const cases = selectCases(
        files.flatMap((file) => loadCases(`${file}.json`)),
        { perCategory: options.perCategory }
      );
      messages = cases.map((evalCase) => toSeedMessage(evalCase));
    }
    const appended = await seedMailbox(deps, { orgId: options.orgId }, options.mailboxId, {
      count: options.count,
      testAddress: deps.testAddress,
      messages,
      folder: options.folder,
      ...(options.ownerFrom === undefined ? {} : { ownerFrom: options.ownerFrom }),
    });
    out.print(`appended ${appended}`);
    return 0;
  } catch (error) {
    const reason = oauthReasonLine(error);
    if (reason !== null) {
      out.fail(reason);
      return 1;
    }
    return reportFailure(out, error, "message");
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxSeedArgs(argv);
  try {
    return await withMailboxDeps(out, (deps) => run(options, deps));
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-seed", descriptions: cliDescriptions, main });
}
