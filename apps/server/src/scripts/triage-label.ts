import { listForLabeling, parseLabelInput, recordFeedback, type LabelItem } from "../modules/triage";
import { exitCodeOf, runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { loadConfig, testMailRule } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { cliDescriptions, parseTriageLabelArgs } from "./triage-label-args";

// Mail data goes to stdout for the user, never through `log` (log lines carry no mail data).
function showItem(cli: CliRawOutput, item: LabelItem, index: number, total: number): void {
  cli.raw("");
  cli.raw(`[${index}/${total}] ${item.emailId}`);
  cli.raw(`  received:   ${item.receivedAt.toISOString()}`);
  cli.raw(`  from:       ${item.from ?? "-"}`);
  cli.raw(`  subject:    ${item.subject ?? "-"}`);
  cli.raw(`  predicted:  ${item.category} (confidence ${item.confidence})`);
  cli.raw(`  model said: ${item.modelCategory ?? "-"}`);
  cli.raw(`  summary:    ${item.summary ?? "-"}`);
  cli.raw("  1 urgent, 2 needs_reply, 3 info, 4 notification, 5 spam; Enter = right, w = wrong, s = skip, q = quit");
}

const main: CliSpec["main"] = async (argv, cli) => {
  const options = parseTriageLabelArgs(argv);

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
      cli.print(`feedback ${result.id} verdict ${result.verdict}`);
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
      showItem(cli, item, position + 1, items.length);
      let done = false;
      while (!done) {
        // prompt() returns null at the end of the input (Ctrl-D or a closed pipe): quit.
        const answer = prompt(">");
        const parsed = answer === null ? ({ kind: "quit" } as const) : parseLabelInput(answer, item.category);
        if (parsed.kind === "ask_again") {
          cli.raw(parsed.message);
        } else if (parsed.kind === "skip") {
          skipped += 1;
          done = true;
        } else if (parsed.kind === "quit") {
          cli.print(`labeled ${labeled}, skipped ${skipped}`);
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
    cli.print(`labeled ${labeled}, skipped ${skipped}`);
    return 0;
  } catch (error) {
    const code = exitCodeOf(error);
    cli.fail(`${code === 3 ? "unreachable" : "failed"}: ${describeError(error)}`);
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "triage-label", descriptions: cliDescriptions, main });
}
