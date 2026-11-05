import { parseArgs } from "node:util";

import { costPerMail, llmPrices, monthlyCost } from "@ea/core";
import { z } from "zod";

import { listUsageSince, type MailKind, type UsageRow } from "../modules/triage";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("triage-cost");

const usage = "usage: bun run triage:cost --org-id <uuid> --mailbox-id <uuid> [--days 7] [--mail real|synthetic]";

const MAILS_PER_DAY = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Options {
  orgId: string;
  mailboxId: string;
  days: number;
  mail: MailKind;
}

function readOptions(): Options | undefined {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "mailbox-id": { type: "string" },
        days: { type: "string", default: "7" },
        mail: { type: "string", default: "real" },
      },
      strict: true,
    });
    const uuid = z.uuid();
    const orgId = values["org-id"];
    const mailboxId = values["mailbox-id"];
    if (orgId === undefined || !uuid.safeParse(orgId).success) return undefined;
    if (mailboxId === undefined || !uuid.safeParse(mailboxId).success) return undefined;
    const days = z.coerce.number().int().min(1).max(365).safeParse(values.days);
    const mail = z.enum(["real", "synthetic"]).safeParse(values.mail);
    if (!days.success || !mail.success) return undefined;
    return { orgId, mailboxId, days: days.data, mail: mail.data };
  } catch {
    return undefined;
  }
}

// The figures are for the user, not log lines: they go to stdout.
function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] ?? null;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function num(value: number | null): string {
  return value === null ? "n/a" : String(Math.round(value));
}

function usd(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(4)}`;
}

function nonNull(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

function reportModel(model: string, rows: UsageRow[], days: number): void {
  // Latency comes from stored results only: the latency of an error `llm.call` row includes the rate-limiter wait.
  const latencies = nonNull(rows.map((r) => r.latency_ms)).sort((a, b) => a - b);
  const costs = nonNull(rows.map((r) => costPerMail(model, r.tokens_in ?? 0, r.tokens_out ?? 0, r.created_at)));
  const avgCost = average(costs);
  const perDay = rows.length / days;

  out("");
  out(`model ${model}`);
  out(`  LLM results: ${rows.length}`);
  out(`  LLM results per day (observed, over ${days} days): ${perDay.toFixed(2)}`);
  out(
    `  average tokens in / out: ${num(average(nonNull(rows.map((r) => r.tokens_in))))} / ${num(average(nonNull(rows.map((r) => r.tokens_out))))}`
  );
  out(`  latency p50 / p95: ${num(percentile(latencies, 0.5))} ms / ${num(percentile(latencies, 0.95))} ms`);
  out(`  average cost per mail: ${usd(avgCost)}`);
  out(
    `  cost per mailbox per month at ${perDay.toFixed(2)} mails per day: ${usd(avgCost === null ? null : monthlyCost(avgCost, perDay))}`
  );
  out(
    `  cost per mailbox per month at ${MAILS_PER_DAY} mails per day: ${usd(avgCost === null ? null : monthlyCost(avgCost, MAILS_PER_DAY))}`
  );

  const prices = Object.hasOwn(llmPrices, model) ? llmPrices[model] : undefined;
  if (!prices) out(`  paid-tier price: none for ${model}`);
  for (const price of prices ?? []) {
    out(`  paid-tier price, source ${price.source}, read ${price.checked}`);
  }
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const now = new Date();
    const since = new Date(now.getTime() - options.days * DAY_MS);
    const rows = await listUsageSince(db, { orgId: options.orgId }, options.mailboxId, since, { mail: options.mail });

    out(`triage cost, mailbox ${options.mailboxId}, ${options.mail} mail, last ${options.days} days`);
    const byModel = new Map<string, UsageRow[]>();
    for (const row of rows) byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
    if (byModel.size === 0) out("no results with an LLM call");
    for (const [model, modelRows] of byModel) reportModel(model, modelRows, options.days);

    out("");
    out("Rows without a model (blocklist, triage_error, llm_blocked) are not counted.");
    return 0;
  } catch (error) {
    log.error("failed:", describeError(error));
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", describeError(error));
    process.exit(1);
  });
