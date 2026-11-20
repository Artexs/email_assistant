import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyBlindLabels,
  type Batch,
  batchCategories,
  batchSchema,
  blindLabelsSchema,
  blindView,
  buildSendRequest,
  caseStates,
  DAY_MS,
  type PersonaFile,
  personaFileSchema,
  planSends,
  type SendLogLine,
  sentInWindow,
  validateBatch,
} from "@ea/core";

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
import { type CliRawOutput, runCli, type CliSpec } from "../platform/cli";
import { loadTestmailConfig } from "../platform/config";
import { HardError } from "../platform/errors";

import { failureOf } from "./lib/testmail-failure";
import { cliDescriptions, parseTestmailArgs, type TestmailOptions } from "./testmail-args";

const addressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function runSetup(io: CliRawOutput): Promise<number> {
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
    io.fail("inbox address differs from the persona file");
    return 1;
  }
  io.raw(`inbox ${inbox.email} status ${inbox.status ?? "active"} status_until ${inbox.statusUntil ?? "-"}`);
  return 0;
}

function runValidate(options: TestmailOptions<"validate">, io: CliRawOutput): number {
  const paths = testmailPaths();
  const batch = loadBatch(paths.batchesDir, options.batch);
  const personas = loadPersonas(paths.personasFile);
  const target = loadRemoteTarget(paths.targetFile);
  const issues = validateBatch(batch, personas, {
    fileBatchId: options.batch,
    testAddress: target.testAddress,
    requireBlind: !options["allow-unlabelled"],
  });
  for (const issue of issues) io.raw(`case ${issue.caseId ?? "-"} ${issue.code} ${issue.detail}`);
  for (const category of batchCategories) {
    io.raw(`category ${category} ${batch.cases.filter((item) => item.expected.category === category).length}`);
  }
  for (const [persona, count] of countBy(batch.cases, (item) => item.persona)) io.raw(`persona ${persona} ${count}`);
  io.raw(issues.length === 0 ? "valid" : `invalid (${issues.length} issues)`);
  return issues.length === 0 ? 0 : 1;
}

function runBlind(options: TestmailOptions<"blind">, io: CliRawOutput): number {
  const paths = testmailPaths();
  const batch = loadBatch(paths.batchesDir, options.batch);
  const personas = loadPersonas(paths.personasFile);
  if (options.apply === undefined || options.checker === undefined) {
    io.raw(JSON.stringify(blindView(batch, personas), null, 2));
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
  io.raw(
    `agree ${agree}, disagree ${disagreements.length}, missing ${applied.missingIds.length}, unknown ${applied.unknownIds.length}`
  );
  for (const line of disagreements) io.raw(line);
  return applied.unknownIds.length > 0 ? 1 : 0;
}

/** The one allowed recipient. Runs before any log read and any HTTP call. */
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
  options: SendOptions,
  io: CliRawOutput
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
    io.raw(`${action.kind === "send" ? "would send" : "would recover"} ${action.caseId} attempt ${action.attempt}`);
  }
  for (const skipped of plan.skipped) io.raw(`skip ${skipped.caseId} ${skipped.reason}`);
}

type SendOptions = TestmailOptions<"send">;

async function runSendCommand(options: SendOptions, io: CliRawOutput): Promise<number> {
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
    for (const issue of issues) io.raw(`case ${issue.caseId ?? "-"} ${issue.code} ${issue.detail}`);
    io.raw(`invalid (${issues.length} issues)`);
    return 1;
  }

  const address = inboxAddress(personas);
  if (options["dry-run"]) {
    const all = readAllSendLogs(paths.runsDir);
    assertLogsReadable(all.badFiles);
    // The hash assumes inbox_id == email (<username>@agentmail.to).
    printDryRun(batch, address, to, readSendLog(paths.batchLog(options.batch)).lines, all.lines, options, io);
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
        io.fail("inbox not found: run bun run testmail:setup");
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
    io.raw(
      `sent ${result.sent.length}, recovered ${result.recovered.length}, failed ${result.failed.length}, remaining ${result.remaining.length}`
    );
    for (const item of result.failed) io.raw(`failed ${item.caseId} ${item.code}`);
    for (const item of result.remaining) io.raw(`remaining ${item.caseId} ${item.reason}`);
    if (result.stoppedBy !== null) io.raw(`stopped: ${result.stoppedBy}`);
    return result.exitCode;
  } finally {
    lock.release();
  }
}

function runStatus(options: TestmailOptions<"status">, io: CliRawOutput): number {
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
    io.raw(`${testCase.id} ${testCase.expected.category} ${kind}${suffix}`);
  }
  io.raw(
    countBy(stateNames, (name) => name)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")
  );
  return 0;
}

// A usage error is thrown by the parse, before any file is read, and `runCli` maps it to exit 2. Every other error is
// reported here with its safe line: the operator reads the message of a `HardError`, a `ConfigError` or an `AgentMailError`.
const main: CliSpec["main"] = async (argv, io) => {
  const args = parseTestmailArgs(argv);
  try {
    switch (args.command) {
      case "setup":
        return await runSetup(io);
      case "validate":
        return runValidate(args.options, io);
      case "blind":
        return runBlind(args.options, io);
      case "send":
        return await runSendCommand(args.options, io);
      case "status":
        return runStatus(args.options, io);
    }
  } catch (error) {
    const failure = failureOf(error);
    io.fail(failure.text);
    return failure.code;
  }
};

if (import.meta.main) {
  await runCli({ prefix: "testmail", descriptions: cliDescriptions, main });
}
