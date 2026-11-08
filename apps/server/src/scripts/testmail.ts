import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  applyBlindLabels,
  BATCH_ID_PATTERN,
  batchSchema,
  blindLabelsSchema,
  blindView,
  buildSendRequest,
  caseStates,
  personaFileSchema,
  planSends,
  sentInWindow,
  testmailCategories,
  validateBatch,
  type Batch,
  type PersonaFile,
  type SendLogLine,
} from "@ea/core";
import { z } from "zod";

import {
  acquireSendLock,
  AgentMailError,
  appendSendLogLine,
  createAgentMailClient,
  loadRemoteTarget,
  readAllSendLogs,
  readJsonFile,
  readSendLog,
  requestHash,
  runSend,
  testmailPaths,
} from "../modules/testmail";
import { ConfigError, loadTestmailConfig } from "../platform/config";
import { describeError, HardError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("testmail");

const usage = [
  "usage: bun run testmail:setup",
  "       bun run testmail:validate --batch <id> [--allow-unlabelled]",
  "       bun run testmail:blind --batch <id> [--apply <labels.json> --checker <model id>]",
  "       TEST_MAILBOX_ADDRESS=<address> bun run testmail:send --batch <id> [--limit n] [--interval-sec 30] [--daily-cap 50] [--dry-run]",
  "       bun run testmail:status --batch <id>",
  "  Files: evals/testmail/{batches/,personas.json,target.json}, logs and lock in ~/.local/state/ea-testmail/.",
  "  send refuses every recipient except TEST_MAILBOX_ADDRESS, and TEST_MAILBOX_ADDRESS must equal testAddress in evals/testmail/target.json.",
  "  Exit codes: 0 done, 1 error or a case needs a fix, 2 run again later.",
].join("\n");

const addressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 3_600_000;

const batchOption = z.string().regex(BATCH_ID_PATTERN);

const optionSchemas = {
  setup: z.object({}).strict(),
  validate: z.object({ batch: batchOption, "allow-unlabelled": z.boolean().default(false) }).strict(),
  blind: z
    .object({ batch: batchOption, apply: z.string().min(1).optional(), checker: z.string().min(1).max(80).optional() })
    .strict()
    .refine((options) => (options.apply === undefined) === (options.checker === undefined)),
  send: z
    .object({
      batch: batchOption,
      limit: z.coerce.number().int().min(0).optional(),
      "interval-sec": z.coerce.number().int().min(5).max(600).default(30),
      "daily-cap": z.coerce.number().int().min(1).max(95).default(50),
      "dry-run": z.boolean().default(false),
    })
    .strict(),
  status: z.object({ batch: batchOption }).strict(),
} as const;

type Command = keyof typeof optionSchemas;

const parseOptionTypes = {
  batch: { type: "string" },
  apply: { type: "string" },
  checker: { type: "string" },
  limit: { type: "string" },
  "interval-sec": { type: "string" },
  "daily-cap": { type: "string" },
  "allow-unlabelled": { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const;

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`);
}

function loadBatch(batchesDir: string, id: string): Batch {
  return readJsonFile(join(batchesDir, `${id}.json`), batchSchema);
}

function loadPersonas(file: string): PersonaFile {
  return readJsonFile(file, personaFileSchema);
}

function assertLogsReadable(badFiles: string[]): void {
  if (badFiles.length > 0) {
    throw new HardError(`send log damaged: ${badFiles.join(", ")}; stop and ask the user`);
  }
}

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function inboxAddress(personas: PersonaFile): string {
  return `${personas.inbox.username}@agentmail.to`;
}

function createClient() {
  const config = loadTestmailConfig();
  return createAgentMailClient({ apiKey: config.AGENTMAIL_API_KEY, baseUrl: config.AGENTMAIL_BASE_URL });
}

async function runSetup(): Promise<number> {
  const paths = testmailPaths();
  const personas = loadPersonas(paths.personasFile);
  const client = createClient();
  const address = inboxAddress(personas);
  let inbox;
  try {
    inbox = await client.getInbox(address);
  } catch (error) {
    // Only a 404 creates the inbox; any other error (also a 409 on create) ends the run, so nothing loops.
    if (!(error instanceof AgentMailError) || error.status !== 404) throw error;
    await client.ensureInbox({
      username: personas.inbox.username,
      clientId: personas.inbox.clientId,
      displayName: personas.inbox.defaultDisplayName,
    });
    inbox = await client.getInbox(address);
  }
  if (inbox.email !== address) {
    log.error("inbox address differs from the persona file");
    return 1;
  }
  out(`inbox ${inbox.email} status ${inbox.status ?? "active"} status_until ${inbox.statusUntil ?? "-"}`);
  return 0;
}

function runValidate(options: z.infer<(typeof optionSchemas)["validate"]>): number {
  const paths = testmailPaths();
  const batch = loadBatch(paths.batchesDir, options.batch);
  const personas = loadPersonas(paths.personasFile);
  const target = loadRemoteTarget(paths.targetFile);
  const issues = validateBatch(batch, personas, {
    fileBatchId: options.batch,
    testAddress: target.testAddress,
    requireBlind: !options["allow-unlabelled"],
  });
  for (const issue of issues) out(`case ${issue.caseId ?? "-"} ${issue.code} ${issue.detail}`);
  for (const category of testmailCategories) {
    out(`category ${category} ${batch.cases.filter((item) => item.expected.category === category).length}`);
  }
  for (const [persona, count] of countBy(batch.cases, (item) => item.persona)) out(`persona ${persona} ${count}`);
  out(issues.length === 0 ? "valid" : `invalid (${issues.length} issues)`);
  return issues.length === 0 ? 0 : 1;
}

function runBlind(options: z.infer<(typeof optionSchemas)["blind"]>): number {
  const paths = testmailPaths();
  const batch = loadBatch(paths.batchesDir, options.batch);
  const personas = loadPersonas(paths.personasFile);
  if (options.apply === undefined || options.checker === undefined) {
    out(JSON.stringify(blindView(batch, personas), null, 2));
    return 0;
  }
  const labels = readJsonFile(options.apply, blindLabelsSchema);
  const applied = applyBlindLabels(batch, labels, options.checker);
  writeFileSync(join(paths.batchesDir, `${options.batch}.json`), `${JSON.stringify(applied.batch, null, 2)}\n`);
  const expectedById = new Map(batch.cases.map((item) => [item.id, item.expected.category]));
  let agree = 0;
  const disagreements: string[] = [];
  for (const label of labels) {
    const expected = expectedById.get(label.id);
    if (expected === undefined) continue;
    if (expected === label.category) agree += 1;
    else disagreements.push(`disagree ${label.id}: expected ${expected}, blind ${label.category}`);
  }
  out(
    `agree ${agree}, disagree ${disagreements.length}, missing ${applied.missingIds.length}, unknown ${applied.unknownIds.length}`
  );
  for (const line of disagreements) out(line);
  return applied.unknownIds.length > 0 ? 1 : 0;
}

/** D2: the one allowed recipient. Runs before any log read and any HTTP call. */
function guardRecipient(testAddress: string): string {
  const address = process.env.TEST_MAILBOX_ADDRESS?.trim();
  if (address === undefined || address === "") throw new HardError("TEST_MAILBOX_ADDRESS is not set: send refused");
  if (!addressPattern.test(address)) {
    throw new HardError("TEST_MAILBOX_ADDRESS is not an address: send refused");
  }
  if (address.toLowerCase().endsWith("@agentmail.to")) {
    throw new HardError("TEST_MAILBOX_ADDRESS is an AgentMail address: send refused");
  }
  if (address.toLowerCase() !== testAddress.toLowerCase()) {
    throw new HardError("TEST_MAILBOX_ADDRESS differs from evals/testmail/target.json: send refused");
  }
  return testAddress.trim();
}

function printDryRun(
  batch: Batch,
  inboxId: string,
  to: string,
  lines: SendLogLine[],
  allLines: SendLogLine[],
  options: SendOptions
): void {
  const caseIds = batch.cases.map((item) => item.id);
  const states = caseStates(batch.batch, caseIds, lines);
  const hashes = new Map<string, string>();
  for (const testCase of batch.cases) {
    let parentMessageId: string | null = null;
    if (testCase.replyTo !== undefined) {
      const parent = states.get(testCase.replyTo);
      if (parent?.kind !== "sent") continue;
      parentMessageId = parent.messageId;
    }
    hashes.set(
      testCase.id,
      requestHash(inboxId, buildSendRequest({ batchId: batch.batch, testCase, to, parentMessageId }))
    );
  }
  const now = new Date();
  const plan = planSends({
    batch,
    states,
    hashes,
    now,
    sentInLast24h: sentInWindow(allLines, now, DAY_MS),
    dailyCap: options["daily-cap"],
    limit: options.limit ?? null,
  });
  for (const action of plan.actions) {
    out(`${action.kind === "send" ? "would send" : "would recover"} ${action.caseId} attempt ${action.attempt}`);
  }
  for (const skipped of plan.skipped) out(`skip ${skipped.caseId} ${skipped.reason}`);
}

type SendOptions = z.infer<(typeof optionSchemas)["send"]>;

async function runSendCommand(options: SendOptions): Promise<number> {
  const paths = testmailPaths();
  const target = loadRemoteTarget(paths.targetFile);
  const to = guardRecipient(target.testAddress);
  const batch = loadBatch(paths.batchesDir, options.batch);
  const personas = loadPersonas(paths.personasFile);
  const issues = validateBatch(batch, personas, {
    fileBatchId: options.batch,
    testAddress: target.testAddress,
    requireBlind: true,
  });
  if (issues.length > 0) {
    for (const issue of issues) out(`case ${issue.caseId ?? "-"} ${issue.code} ${issue.detail}`);
    out(`invalid (${issues.length} issues)`);
    return 1;
  }

  const address = inboxAddress(personas);
  if (options["dry-run"]) {
    const all = readAllSendLogs(paths.runsDir);
    assertLogsReadable(all.badFiles);
    // The hash assumes inbox_id == email (<username>@agentmail.to).
    printDryRun(batch, address, to, readSendLog(paths.batchLog(options.batch)).lines, all.lines, options);
    return 0;
  }

  const client = createClient();
  const lock = acquireSendLock(paths.lockFile);
  try {
    const all = readAllSendLogs(paths.runsDir);
    assertLogsReadable(all.badFiles);
    const batchLogFile = paths.batchLog(options.batch);
    let inbox;
    try {
      inbox = await client.getInbox(address);
    } catch (error) {
      if (error instanceof AgentMailError && error.status === 404) {
        log.error("inbox not found: run bun run testmail:setup");
        return 1;
      }
      throw error;
    }
    const result = await runSend(
      {
        client,
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        append: (line) => appendSendLogLine(batchLogFile, line),
      },
      {
        batch,
        personas,
        inboxId: inbox.inboxId,
        to,
        lines: readSendLog(batchLogFile).lines,
        sentInLast24h: sentInWindow(all.lines, new Date(), DAY_MS),
        dailyCap: options["daily-cap"],
        limit: options.limit ?? null,
        intervalMs: options["interval-sec"] * 1000,
        currentDisplayName: inbox.displayName,
      }
    );
    out(
      `sent ${result.sent.length}, recovered ${result.recovered.length}, failed ${result.failed.length}, remaining ${result.remaining.length}`
    );
    for (const item of result.failed) out(`failed ${item.caseId} ${item.code}`);
    for (const item of result.remaining) out(`remaining ${item.caseId} ${item.reason}`);
    if (result.stoppedBy !== null) out(`stopped: ${result.stoppedBy}`);
    return result.exitCode;
  } finally {
    lock.release();
  }
}

function runStatus(options: z.infer<(typeof optionSchemas)["status"]>): number {
  const paths = testmailPaths();
  const batch = loadBatch(paths.batchesDir, options.batch);
  const all = readAllSendLogs(paths.runsDir);
  assertLogsReadable(all.badFiles);
  const lines = readSendLog(paths.batchLog(options.batch)).lines;
  const states = caseStates(
    batch.batch,
    batch.cases.map((item) => item.id),
    lines
  );
  const stateNames: string[] = [];
  for (const testCase of batch.cases) {
    const kind = states.get(testCase.id)?.kind ?? "due";
    stateNames.push(kind);
    const delivered = lines
      .filter((line) => line.type === "delivered" && line.batch === batch.batch && line.case === testCase.id)
      .at(-1);
    const suffix = delivered?.type === "delivered" ? ` ${delivered.folder}/${delivered.result}` : "";
    out(`${testCase.id} ${testCase.expected.category} ${kind}${suffix}`);
  }
  out(
    countBy(stateNames, (name) => name)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")
  );
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || !Object.hasOwn(optionSchemas, command)) {
    log.error(usage);
    return 1;
  }
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: parseOptionTypes, strict: true, allowPositionals: false }));
  } catch {
    log.error(usage);
    return 1;
  }
  const parsed = optionSchemas[command as Command].safeParse(values);
  if (!parsed.success) {
    log.error(issueLines(parsed.error).join("\n"));
    log.error(usage);
    return 1;
  }
  switch (command as Command) {
    case "setup":
      return runSetup();
    case "validate":
      return runValidate(parsed.data as z.infer<(typeof optionSchemas)["validate"]>);
    case "blind":
      return runBlind(parsed.data as z.infer<(typeof optionSchemas)["blind"]>);
    case "send":
      return runSendCommand(parsed.data as SendOptions);
    case "status":
      return runStatus(parsed.data as z.infer<(typeof optionSchemas)["status"]>);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // AgentMailError.message is log-safe: op, status, name and code only.
    if (error instanceof HardError || error instanceof ConfigError || error instanceof AgentMailError) {
      log.error(error.message);
    } else log.error("failed:", describeError(error));
    process.exit(1);
  });
