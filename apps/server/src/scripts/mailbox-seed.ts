import { format } from "node:util";

import { selectCases } from "@ea/core";

import { seedMailbox, type SeedMessage } from "../modules/mail";

import { type CliDeps, oauthReasonLine, runMailboxCli } from "./lib/mailbox-cli";
import { loadCases, readSeedOptions, toSeedMessage, usage } from "./mailbox-seed-args";

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  const { out } = deps;
  const options = readSeedOptions(argv);
  if (!options) {
    out.fail(usage);
    return 1;
  }
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
    out.fail(oauthReasonLine(error) ?? `failed: ${error instanceof Error ? error.message : format(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await runMailboxCli("mailbox-seed", run));
}
