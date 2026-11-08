import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  BATCH_ID_PATTERN,
  batchSchema,
  buildTargetInput,
  personaFileSchema,
  sendLogLineSchema,
  type SendLogLine,
} from "@ea/core";
import { z } from "zod";

import {
  acquireSendLock,
  appendSendLogLine,
  buildReviewedBundle,
  deliveredLogLines,
  findEnvValuesInBundle,
  loadRemoteTarget,
  parseDeliverOutput,
  readSendLog,
  remoteBundlePath,
  remoteCommand,
  testmailPaths,
  type BuiltBundle,
  type TestmailPaths,
} from "../modules/testmail";
import { describeError, HardError } from "../platform/errors";

export interface RemoteDeps {
  run(argv: string[], opts?: { cwd?: string; stdin?: string }): Promise<{ code: number; stdout: string }>;
  buildBundle(outDir: string): Promise<BuiltBundle>;
  now(): Date;
  randomId(): string;
  paths: TestmailPaths;
}

const usage = [
  "usage: bun run testmail:remote deliver --batch <id> [--check-only] [--dry-run] [--print-input]",
  "       bun run testmail:remote compare --batch <id> [--bar 0.98] [--min-kept 30] [--out <file.md>] [--dry-run] [--print-input]",
  "  It bundles testmail-target from a clean worktree of origin/master, copies it to the VPS of evals/testmail/target.json,",
  "  and runs it in a one-off server container. Exit code = the remote exit code (1 on a git, build, scp or ssh error).",
  '  On this PC set GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" for the git fetch.',
].join("\n");

const optionSchema = z
  .object({
    batch: z.string().regex(BATCH_ID_PATTERN),
    "check-only": z.boolean().default(false),
    "dry-run": z.boolean().default(false),
    "print-input": z.boolean().default(false),
    bar: z.coerce.number().gt(0).max(1).optional(),
    "min-kept": z.coerce.number().int().min(1).max(10000).optional(),
    out: z.string().min(1).optional(),
  })
  .strict();
type Options = z.infer<typeof optionSchema>;

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function err(text: string): void {
  process.stderr.write(`${text}\n`);
}

function readJsonFile<T>(file: string, schema: z.ZodType<T>): T {
  if (!existsSync(file)) throw new HardError(`file not found: ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new HardError(`invalid JSON: ${file}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "-"}: ${issue.code}`);
    throw new HardError(`invalid file ${file}\n${issues.join("\n")}`);
  }
  return result.data;
}

function parseOptions(command: string, rest: string[]): Options | undefined {
  try {
    const { values } = parseArgs({
      args: rest,
      options: {
        batch: { type: "string" },
        "check-only": { type: "boolean" },
        "dry-run": { type: "boolean" },
        "print-input": { type: "boolean" },
        bar: { type: "string" },
        "min-kept": { type: "string" },
        out: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    });
    const parsed = optionSchema.safeParse(values);
    if (!parsed.success) return undefined;
    const o = parsed.data;
    if (command === "deliver" && (o.bar !== undefined || o["min-kept"] !== undefined || o.out !== undefined)) {
      return undefined;
    }
    if (command === "compare" && o["check-only"]) return undefined;
    return o;
  } catch {
    return undefined;
  }
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
  options: Options;
  deps: RemoteDeps;
}

async function runRemote({ command, options, deps }: RunInput): Promise<number> {
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
    out(stdin);
    return 0;
  }
  if (input.cases.every((item) => item.messageId === null)) {
    out("nothing sent yet");
    return 2;
  }

  const outDir = mkdtempSync(join(tmpdir(), "ea-testmail-bundle-"));
  try {
    const bundle = await deps.buildBundle(outDir);
    out(`bundled origin/master ${bundle.sha}`);
    const leaked = findEnvValuesInBundle(bundle.text, process.env);
    if (leaked.length > 0) {
      out(`bundle holds env values: ${leaked.join(", ")}; refused`);
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
      out(`scp: ${scp.join(" ")}`);
      out(`ssh: ${ssh.join(" ")}`);
      out(`stdin: ${Buffer.byteLength(stdin)} bytes`);
      return 0;
    }

    const copied = await deps.run(scp);
    if (copied.code !== 0) {
      err(`scp to ${target.host} failed`);
      return 1;
    }
    const result = await deps.run(ssh, { stdin });
    if (result.code === 255) {
      err(`ssh to ${target.host} failed`);
      return 1;
    }

    if (command === "compare") {
      process.stdout.write(result.stdout);
      if (options.out !== undefined) writeFileSync(resolve(options.out), result.stdout);
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
    for (const text of summary(lines)) out(text);
    if (bad > 0) {
      err(`remote output not understood: ${bad} lines`);
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

export async function main(argv: string[], deps: RemoteDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "deliver" && command !== "compare") {
    err(usage);
    return 1;
  }
  const options = parseOptions(command, rest);
  if (options === undefined) {
    err(usage);
    return 1;
  }
  try {
    // deliver appends to the batch log: one send-lock holder at a time, also against testmail:send.
    const needsLock = command === "deliver" && !options["dry-run"] && !options["print-input"];
    const lock = needsLock ? acquireSendLock(deps.paths.lockFile) : undefined;
    try {
      return await runRemote({ command, options, deps });
    } finally {
      lock?.release();
    }
  } catch (error) {
    // A HardError message is written for the operator and holds no secret; every other error shows its label only.
    err(error instanceof HardError ? error.message : `failed: ${describeError(error)}`);
    return 1;
  }
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
  main(process.argv.slice(2), {
    run: realRun,
    buildBundle: (outDir) => buildReviewedBundle({ run: realRun }, { repoRoot, outDir, cacheDir }),
    now: () => new Date(),
    randomId: () => randomUUID(),
    paths: testmailPaths(),
  })
    .then((code) => process.exit(code))
    .catch((error) => {
      err(`failed: ${describeError(error)}`);
      process.exit(1);
    });
}
