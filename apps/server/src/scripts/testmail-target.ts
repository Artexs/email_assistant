import { parseArgs } from "node:util";

import { buildCompareRows, renderCompareTable, targetInputSchema, type TargetInput } from "@ea/core";
import { z } from "zod";

import { configureMailHosts, deliverTestMail, listEmailsByMessageIds } from "../modules/mail";
import { buildRealReport, listLatestTriageByEmailIds, renderEvalReport, type LabeledResult } from "../modules/triage";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError, HardError } from "../platform/errors";
import { createLog, setLogLevel } from "../platform/log";

const log = createLog("testmail-target");

const usage = [
  "usage: bun run testmail:target deliver --org-id <uuid> --mailbox-id <uuid> [--check-only] < input.json",
  "       bun run testmail:target compare --org-id <uuid> --mailbox-id <uuid> [--bar 0.98] [--min-kept 30] < input.json",
  "  input.json: the target input of a batch (bun run testmail:remote … --print-input writes it). deliver refuses every mailbox except TEST_MAILBOX_ADDRESS.",
].join("\n");

const DELIVERED = new Set(["synced", "in_inbox", "moved", "duplicate_removed"]);

function readOptions() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        "check-only": { type: "boolean", default: false },
        bar: { type: "string", default: "0.98" },
        "min-kept": { type: "string", default: "30" },
      },
      allowPositionals: true,
      strict: true,
    });
    const command = positionals.length === 1 ? positionals[0] : undefined;
    if (command !== "deliver" && command !== "compare") return undefined;
    const parsed = z
      .object({
        orgId: z.uuid(),
        mailboxId: z.uuid(),
        checkOnly: z.boolean(),
        bar: z.coerce.number().gt(0).max(1),
        minKept: z.coerce.number().int().min(1),
      })
      .safeParse({
        orgId: values["org-id"],
        mailboxId: values["mailbox-id"],
        checkOnly: values["check-only"],
        bar: values.bar,
        minKept: values["min-kept"],
      });
    if (!parsed.success) return undefined;
    if (command === "compare" && values["check-only"]) return undefined;
    if (command === "deliver" && (values.bar !== "0.98" || values["min-kept"] !== "30")) return undefined;
    return { command, ...parsed.data };
  } catch {
    return undefined;
  }
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function err(text: string): void {
  process.stderr.write(`${text}\n`);
}

async function readInput(): Promise<TargetInput | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(await Bun.stdin.text());
  } catch {
    err("bad input: <json>: invalid_json");
    return undefined;
  }
  const parsed = targetInputSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) err(`bad input: ${issue.path.join(".") || "<root>"}: ${issue.code}`);
    return undefined;
  }
  return parsed.data;
}

async function runDeliver(options: NonNullable<ReturnType<typeof readOptions>>, input: TargetInput): Promise<number> {
  const wanted = input.cases.flatMap((c) =>
    c.messageId !== null && c.sentAt !== null
      ? [{ caseId: c.caseId, messageId: c.messageId, sentAt: new Date(c.sentAt) }]
      : []
  );
  if (wanted.length === 0) {
    err("nothing sent yet");
    return 2;
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
      out(JSON.stringify({ case: result.caseId, result: result.result, folder: result.folder }));
    }
    const missing = results.filter((result) => !DELIVERED.has(result.result)).length;
    err(`deliver ${input.batch}: ${results.length - missing} of ${results.length} delivered, not found ${missing}`);
    return missing === 0 ? 0 : 2;
  } finally {
    await db.destroy();
  }
}

async function runCompare(options: NonNullable<ReturnType<typeof readOptions>>, input: TargetInput): Promise<number> {
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

    out(`# Testmail compare: ${input.batch}`);
    out("");
    out(renderCompareTable(rows));
    out("");
    out("expected labels come from the batch file (writer + blind checker), not from triage_feedback");
    out("");
    out(renderEvalReport(report, { title: `Eval report: testmail batch ${input.batch}` }));

    const pending = rows.filter((row) => row.state !== "not_sent" && row.state !== "triaged").length;
    return pending === 0 ? 0 : 2;
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<number> {
  setLogLevel("warn");
  const options = readOptions();
  if (!options) {
    err(usage);
    return 1;
  }
  const input = await readInput();
  if (!input) return 1;
  try {
    return options.command === "deliver" ? await runDeliver(options, input) : await runCompare(options, input);
  } catch (error) {
    // A HardError message is written for the operator and holds no secret; every other error shows its label only.
    log.error(`failed: ${error instanceof HardError ? error.message : describeError(error)}`);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error(`failed: ${describeError(error)}`);
    process.exit(1);
  });
