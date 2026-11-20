import { buildCompareRows, renderCompareTable, targetInputSchema, type TargetInput } from "@ea/core";

import { configureMailHosts, deliverTestMail, listEmailsByMessageIds } from "../modules/mail";
import { buildRealReport, listLatestTriageByEmailIds, renderEvalReport, type LabeledResult } from "../modules/triage";
import { type CliRawOutput, runCli, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { setLogLevel } from "../platform/log";

import { failureOf } from "./lib/testmail-failure";
import { cliDescriptions, parseTestmailTargetArgs, type TestmailTargetArgs } from "./testmail-target-args";

const DELIVERED = new Set(["synced", "in_inbox", "moved", "duplicate_removed"]);

async function readInput(out: CliRawOutput): Promise<TargetInput | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(await Bun.stdin.text());
  } catch {
    out.writeErr("bad input: <json>: invalid_json\n");
    return undefined;
  }
  const parsed = targetInputSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      out.writeErr(`bad input: ${issue.path.join(".") || "<root>"}: ${issue.code}\n`);
    }
    return undefined;
  }
  return parsed.data;
}

async function runDeliver(options: TestmailTargetArgs, input: TargetInput, out: CliRawOutput): Promise<number> {
  const wanted = input.cases.flatMap((c) =>
    c.messageId !== null && c.sentAt !== null
      ? [{ caseId: c.caseId, messageId: c.messageId, sentAt: new Date(c.sentAt) }]
      : []
  );
  if (wanted.length === 0) {
    out.writeErr("nothing sent yet\n");
    return 1;
  }
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const results = await deliverTestMail({ db, secrets }, { orgId: options.orgId }, options.mailboxId, {
      testAddress: config.TEST_MAILBOX_ADDRESS,
      sender: input.sender,
      wanted,
      checkOnly: options.checkOnly,
    });
    for (const result of results) {
      out.write(`${JSON.stringify({ case: result.caseId, result: result.result, folder: result.folder })}\n`);
    }
    const missing = results.filter((result) => !DELIVERED.has(result.result)).length;
    out.writeErr(
      `deliver ${input.batch}: ${results.length - missing} of ${results.length} delivered, not found ${missing}\n`
    );
    return missing === 0 ? 0 : 4;
  } finally {
    await db.destroy();
  }
}

async function runCompare(options: TestmailTargetArgs, input: TargetInput, out: CliRawOutput): Promise<number> {
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: options.orgId };
    const messageIds = input.cases.flatMap((c) => (c.messageId === null ? [] : [c.messageId]));
    const emails = await listEmailsByMessageIds(db, ctx, options.mailboxId, messageIds);
    const results = await listLatestTriageByEmailIds(
      db,
      ctx,
      emails.map((email) => email.id)
    );
    const rows = buildCompareRows(input, emails, results);

    const labeled: LabeledResult[] = [];
    for (const row of rows) {
      const result = row.state === "triaged" ? results.find((item) => item.email_id === row.emailId) : undefined;
      if (result === undefined) continue;
      const ok = row.ok === true;
      labeled.push({
        email_id: result.email_id,
        category: result.category,
        confidence: result.confidence,
        reason_code: result.reason_code,
        model: result.model,
        fields: result.fields,
        verdict: ok ? "right" : "wrong",
        true_category: row.expected,
      });
    }
    const report = buildRealReport(labeled, {
      bar: options.bar,
      minKept: options.minKept,
      mail: "synthetic",
      now: new Date(),
    });

    out.write(`# Testmail compare: ${input.batch}\n`);
    out.write("\n");
    out.write(`${renderCompareTable(rows)}\n`);
    out.write("\n");
    out.write("expected labels come from the batch file (writer + blind checker), not from triage_feedback\n");
    out.write("\n");
    out.write(`${renderEvalReport(report, { title: `Eval report: testmail batch ${input.batch}` })}\n`);

    const pending = rows.filter((row) => row.state !== "not_sent" && row.state !== "triaged").length;
    return pending === 0 ? 0 : 4;
  } finally {
    await db.destroy();
  }
}

// Parses first, then reads the batch input from stdin. Exit 4: some cases are not found or not triaged yet.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseTestmailTargetArgs(argv);
  setLogLevel("warn");
  const input = await readInput(out);
  if (!input) return 1;
  try {
    return options.command === "deliver"
      ? await runDeliver(options, input, out)
      : await runCompare(options, input, out);
  } catch (error) {
    const failure = failureOf(error);
    out.fail(failure.text);
    return failure.code;
  }
};

if (import.meta.main) {
  await runCli({ prefix: "testmail-target", descriptions: cliDescriptions, main });
}
