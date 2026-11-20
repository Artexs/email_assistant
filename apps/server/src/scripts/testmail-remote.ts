import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { batchSchema, buildTargetInput, personaFileSchema, sendLogLineSchema, type SendLogLine } from "@ea/core";

import {
  acquireSendLock,
  appendSendLogLine,
  buildReviewedBundle,
  deliveredLogLines,
  findEnvValuesInBundle,
  loadRemoteTarget,
  parseDeliverOutput,
  readJsonFile,
  readSendLog,
  remoteBundlePath,
  remoteCommand,
  testmailPaths,
  type BuiltBundle,
  type TestmailPaths,
} from "../modules/testmail";
import { type CliRawOutput, runCli, runCliCode, type CliSpec } from "../platform/cli";
import { HardError } from "../platform/errors";

import { failureOf } from "./lib/testmail-failure";
import { cliDescriptions, parseTestmailRemoteArgs, type RemoteOptions } from "./testmail-remote-args";

export interface RemoteDeps {
  run(argv: string[], opts?: { cwd?: string; stdin?: string }): Promise<{ code: number; stdout: string }>;
  buildBundle(outDir: string): Promise<BuiltBundle>;
  now(): Date;
  randomId(): string;
  paths: TestmailPaths;
}

function summary(lines: ReturnType<typeof parseDeliverOutput>["lines"]): string[] {
  const count = (result: string) => lines.filter((line) => line.result === result).length;
  const notFound = lines.filter((line) => line.result === "not_found").map((line) => line.case);
  const text = [
    `moved ${count("moved")}, in inbox ${count("in_inbox")}, duplicates removed ${count("duplicate_removed")}, synced ${count("synced")}, not found ${notFound.length}`,
  ];
  for (const id of notFound) text.push(`not found ${id}`);
  return text;
}

interface RunInput {
  command: "deliver" | "compare";
  options: RemoteOptions;
  deps: RemoteDeps;
  out: CliRawOutput;
}

async function runRemote({ command, options, deps, out }: RunInput): Promise<number> {
  const { paths } = deps;
  const target = loadRemoteTarget(paths.targetFile);
  const personas = readJsonFile(paths.personasFile, personaFileSchema);
  const batch = readJsonFile(join(paths.batchesDir, `${options.batch}.json`), batchSchema);
  if (batch.batch !== options.batch) throw new HardError("batch id differs from the file name");
  const log = readSendLog(paths.batchLog(options.batch));
  if (log.badLines.length > 0) throw new HardError(`send log damaged: ${options.batch}.jsonl; stop and ask the user`);

  const input = buildTargetInput(batch, log.lines, `${personas.inbox.username}@agentmail.to`);
  const stdin = JSON.stringify(input);
  if (options["print-input"]) {
    out.write(`${stdin}\n`);
    return 0;
  }
  if (input.cases.every((item) => item.messageId === null)) {
    out.write("nothing sent yet\n");
    return 1;
  }

  const outDir = mkdtempSync(join(tmpdir(), "ea-testmail-bundle-"));
  try {
    const bundle = await deps.buildBundle(outDir);
    out.write(`bundled origin/master ${bundle.sha}\n`);
    const leaked = findEnvValuesInBundle(bundle.text, process.env);
    if (leaked.length > 0) {
      out.write(`bundle holds env values: ${leaked.join(", ")}; refused\n`);
      return 1;
    }

    const remotePath = remoteBundlePath(deps.randomId());
    const remote = remoteCommand(target, command, {
      bundlePath: remotePath,
      ...(options.bar === undefined ? {} : { bar: options.bar }),
      ...(options["min-kept"] === undefined ? {} : { minKept: options["min-kept"] }),
      checkOnly: options["check-only"],
    });
    const scp = ["scp", "-q", "-o", "BatchMode=yes", bundle.path, `${target.host}:${remotePath}`];
    const ssh = ["ssh", "-o", "BatchMode=yes", target.host, remote];
    if (options["dry-run"]) {
      out.write(`scp: ${scp.join(" ")}\n`);
      out.write(`ssh: ${ssh.join(" ")}\n`);
      out.write(`stdin: ${Buffer.byteLength(stdin)} bytes\n`);
      return 0;
    }

    const copied = await deps.run(scp);
    if (copied.code !== 0) {
      out.writeErr(`scp to ${target.host} failed\n`);
      return 1;
    }
    const result = await deps.run(ssh, { stdin });
    if (result.code === 255) {
      out.writeErr(`ssh to ${target.host} failed\n`);
      return 1;
    }

    if (command === "compare") {
      out.write(result.stdout);
      // Exit 1 is a remote error: its output is no report. Exit 4 is a report with cases not triaged yet.
      if (options.out !== undefined && (result.code === 0 || result.code === 4))
        writeFileSync(resolve(options.out), result.stdout);
      return result.code;
    }

    const parsed = parseDeliverOutput(result.stdout);
    const known = new Set(batch.cases.map((item) => item.id));
    const lines = parsed.lines.filter((item) => known.has(item.case));
    // A line for a case that is not in the batch is not understood.
    let bad = parsed.bad + (parsed.lines.length - lines.length);
    const toAppend: SendLogLine[] = [];
    for (const line of deliveredLogLines(batch.batch, lines, deps.now())) {
      if (sendLogLineSchema.safeParse(line).success) toAppend.push(line);
      else bad += 1;
    }
    for (const text of summary(lines)) out.write(`${text}\n`);
    if (bad > 0) {
      out.writeErr(`remote output not understood: ${bad} lines\n`);
      return 1;
    }
    if (!options["check-only"]) {
      for (const line of toAppend) appendSendLogLine(paths.batchLog(options.batch), line);
    }
    return result.code;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// A usage error is thrown by the parse, before any file is read, and `runCli` maps it to exit 2. Every other error is
// reported here: a `HardError` message is written for the operator and holds no secret; any other error shows its label only.
async function runTestmailRemote(argv: string[], deps: RemoteDeps, out: CliRawOutput): Promise<number> {
  const { command, options } = parseTestmailRemoteArgs(argv);
  try {
    // deliver appends to the batch log: one send-lock holder at a time, also against testmail:send.
    const needsLock = command === "deliver" && !options["dry-run"] && !options["print-input"];
    const lock = needsLock ? acquireSendLock(deps.paths.lockFile) : undefined;
    try {
      return await runRemote({ command, options, deps, out });
    } finally {
      lock?.release();
    }
  } catch (error) {
    const failure = failureOf(error);
    out.writeErr(`${failure.text}\n`);
    return failure.code;
  }
}

/** The whole tool with injected processes, for the tests: the exit code of the standard run (docs/cli.md). */
export function main(argv: string[], deps: RemoteDeps): Promise<number> {
  return runCliCode({
    prefix: "testmail-remote",
    descriptions: cliDescriptions,
    argv,
    main: (args, out) => runTestmailRemote(args, deps, out),
  });
}

async function realRun(
  argv: string[],
  opts: { cwd?: string; stdin?: string } = {}
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(argv, {
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dir, "../../../..");
  const cacheDir = join(homedir(), ".cache/ea-testmail");
  const run: CliSpec["main"] = (argv, out) =>
    runTestmailRemote(
      argv,
      {
        run: realRun,
        buildBundle: (outDir) => buildReviewedBundle({ run: realRun }, { repoRoot, outDir, cacheDir }),
        now: () => new Date(),
        randomId: () => randomUUID(),
        paths: testmailPaths(),
      },
      out
    );
  await runCli({ prefix: "testmail-remote", descriptions: cliDescriptions, main: run });
}
