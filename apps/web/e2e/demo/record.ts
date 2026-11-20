import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadRepoDotEnv } from "../../../server/src/scripts/e2e-job-env-args";
import { cutPlan, ffmpegArgs } from "../lib/demo/encode";
import { type DemoPrepared, prepareDemoRun } from "../lib/demo/prepare";
import { parseRecordArgs, preflightProblem, type RecordArgs, videoProblem } from "../lib/demo/record-args";
import { shotSource, type ShotSource } from "../lib/shot-source";
import { DEMO_STEPS, stepView, toVtt, type DemoCue } from "../lib/demo/steps";
import { modelCheck, uploadVerdict, type VerdictInput } from "../lib/demo/verdict";
import { resetDemoDb } from "./db-reset";

// `bun run demo:record [--seed <file>] [--out <dir>]`: records the demo video on the e2e servers and the demo database, then encodes it.
//
// 1. Checks, before any server starts or any database changes: ffmpeg, a named seed file, the demo database keys and name. On the
//    demo source also the seed (`planDemoRun`), the gate copy and the replay server of the demo week's classifier answers.
// 2. Rebuilds the demo database (drop every object, `db:migrate`), so a second run starts from the same state.
// 3. Runs `demo.config.ts` (Playwright): servers, seed, the eight steps in one recorded page; it writes the raw video and the cue times.
// 4. Encodes `demo.mp4` (`cutPlan`: only the steps stay; the lead-in and every gap of 1 s or more between two steps are cut), writes
//    `demo.en.vtt` and `demo.pl.vtt` with the cue times on the cut timeline, and prints the duration, the size and the sha256 of `demo.mp4` and of both caption files (the owner pins the three hashes when the video goes public).
// On the demo source the run then prints `demo_replay hits=<n> misses=<n>` and `demo_gate final|provisional`, and exits 1 on a replay
// miss or when the replay answered nothing. It also checks the model lines of the servers (`modelCheck`): `demo_llm_checked hits=<n>`,
// or exit 1 with `demo_llm_unchecked`.
// Exit 1 on a refusal, a failed run, an MP4 over 15 MB, or a length outside 100 to 130 seconds. On every exit path the last line is
// the verdict (`uploadVerdict`): `demo_source demo: upload candidate`, or `not for upload: <first reason>`. It never changes the exit code.
// Run it under
// `flock /tmp/email-assistant-shared-tests.lock` (fixed ports, one shared mail server, one shared demo database).
const repoRoot = resolve(import.meta.dirname, "../../../..");

function print(text: string): void {
  // eslint-disable-next-line no-console
  console.log(`[demo-record] ${text}`);
}

function fail(text: string): number {
  // eslint-disable-next-line no-console
  console.error(`[demo-record] ${text}`);
  return 1;
}

// What the verdict reads. A value the run does not reach stays at the value of a run that is not perfect.
const facts: Omit<VerdictInput, "exitCode"> = {
  source: "e2e",
  seedDay: null,
  gateProvisional: true,
  misses: 1,
  notLive: ["unreached"],
  llmChecked: false,
};

// Copies a child stream to the console as it comes, and keeps the text.
async function forward(stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream, kept: string[]): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    sink.write(chunk);
    kept.push(decoder.decode(chunk, { stream: true }));
  }
}

async function run(
  command: string[],
  env: Record<string, string | undefined>,
  capture = false
): Promise<{ code: number; stdout: string }> {
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    env,
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdout = capture ? await new Response(child.stdout).text() : "";
  return { code: await child.exited, stdout };
}

// Runs a command with its output on the console and in the returned lines (stdout and stderr).
async function runLogged(
  command: string[],
  env: Record<string, string | undefined>
): Promise<{ code: number; lines: string[] }> {
  const child = Bun.spawn(command, { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
  const kept: string[] = [];
  await Promise.all([forward(child.stdout, process.stdout, kept), forward(child.stderr, process.stderr, kept)]);
  return { code: await child.exited, lines: kept.join("").split("\n") };
}

async function main(): Promise<number> {
  loadRepoDotEnv(repoRoot);
  const args = parseRecordArgs(process.argv.slice(2));
  if (typeof args === "string") return fail(args);
  const problem = preflightProblem(args, { env: process.env });
  if (problem !== null) return fail(problem);
  // The servers serve the static panel: a missing build makes every page answer 503 (`bun run web:build`, as the CI e2e job does).
  if (!existsSync(join(repoRoot, "apps/web/dist/404.html"))) return fail("web_build_missing: run bun run web:build");
  const migratorUrl = process.env.DEMO_MIGRATOR_DATABASE_URL ?? "";

  let source: ShotSource;
  try {
    source = shotSource(args.seed === undefined ? process.env : { ...process.env, DEMO_SEED_FILE: args.seed });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "seed_missing");
  }
  facts.source = source.kind;

  const work = join(args.out, ".work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    DEMO_WORK_DIR: work,
    ...(source.kind === "demo" ? { DEMO_SEED_FILE: source.file } : {}),
  };

  let demo: DemoPrepared | null = null;
  if (source.kind === "demo") {
    const prepared = await prepareDemoRun(source.file, work);
    if (typeof prepared === "string") return fail(prepared);
    demo = prepared;
    facts.seedDay = prepared.seedDay;
    print(`demo_seed_day ${prepared.seedDay} exported_at ${prepared.exportedAt}`);
    env.DEMO_PLAN_FILE = prepared.planFile;
    env.DEMO_REPLAY_PORT = `${prepared.replay.port}`;
    env.DEMO_GATE_DIR = prepared.gateDir;
  }
  const output: string[] = [];
  if (demo === null) return recordSteps({ args, source, work, env, migratorUrl, output });
  let code: number;
  try {
    code = await recordSteps({ args, source, work, env, migratorUrl, output });
  } catch (error) {
    await demo.replay.stop();
    throw error;
  }
  const replay = await closeReplay(demo, code === 0);
  if (code !== 0) return code;
  if (replay.code !== 0) return replay.code;
  return checkModels(demo, replay.hits, output);
}

// Every model line of the servers must name the own endpoint on loopback, and the replay must have answered each call of the run:
// the history mails, the 4 mails of the shadow step and the 3 after the tap.
function checkModels(demo: DemoPrepared, hits: number, output: readonly string[]): number {
  const problem = modelCheck({ lines: [...output], hits, expectedHits: demo.plan.history.length + 7 });
  if (problem !== null) return fail(problem);
  facts.llmChecked = true;
  print(`demo_llm_checked hits=${hits}`);
  return 0;
}

// Prints the replay counts and the gate line, stops the replay server. A miss is a failure at any time; an unused replay is one only
// after a recording that passed (a failed run may stop before the first mail).
async function closeReplay(demo: DemoPrepared, recorded: boolean): Promise<{ code: number; hits: number }> {
  const { hits, misses } = demo.replay.stats();
  await demo.replay.stop();
  facts.misses = misses;
  facts.gateProvisional = demo.gateProvisional;
  print(`demo_replay hits=${hits} misses=${misses}`);
  print(`demo_gate ${demo.gateProvisional ? "provisional" : "final"}`);
  if (misses > 0) return { code: fail(`demo_replay_miss ${misses}`), hits };
  if (recorded && hits === 0) return { code: fail("demo_replay_unused"), hits };
  return { code: 0, hits };
}

interface RecordContext {
  args: RecordArgs;
  source: ShotSource;
  work: string;
  env: Record<string, string | undefined>;
  migratorUrl: string;
  /** The recording run fills this with the lines of its console output. */
  output: string[];
}

async function recordSteps({ args, source, work, env, migratorUrl, output }: RecordContext): Promise<number> {
  print("rebuilding the demo database");
  await resetDemoDb(migratorUrl);
  const migrated = await run(["bun", "run", "db:migrate"], { ...env, MIGRATOR_DATABASE_URL: migratorUrl });
  if (migrated.code !== 0) return fail("demo_db_migrate_failed");

  const recorded = await runLogged(["bunx", "playwright", "test", "-c", "apps/web/e2e/demo/demo.config.ts"], env);
  output.push(...recorded.lines);
  if (recorded.code !== 0) return fail("demo_record_failed");

  const cues = JSON.parse(readFileSync(join(work, "cues.json"), "utf8")) as DemoCue[];
  if (cues.map((cue) => cue.stepId).join(",") !== DEMO_STEPS.map((step) => step.id).join(",")) {
    return fail("demo_cues_mismatch");
  }
  // Only the steps stay in the video: the lead-in and the long gaps are cut, and the cues move onto the cut timeline.
  const cut = cutPlan(cues);
  const mp4 = join(args.out, "demo.mp4");
  writeFileSync(join(args.out, "demo.en.vtt"), toVtt(cut.cues, "en", source.kind));
  writeFileSync(join(args.out, "demo.pl.vtt"), toVtt(cut.cues, "pl", source.kind));
  const encoded = await run(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      ...ffmpegArgs({ input: join(work, "raw.webm"), output: mp4, segments: cut.segments }),
    ],
    process.env
  );
  if (encoded.code !== 0) return fail("ffmpeg_failed");
  const probe = await run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4],
    process.env,
    true
  );
  const seconds = Number(probe.stdout.trim());
  if (probe.code !== 0 || !Number.isFinite(seconds)) return fail("ffprobe_failed");
  const bytes = statSync(mp4).size;
  const sha256 = createHash("sha256").update(readFileSync(mp4)).digest("hex");
  const captionSha256 = (lang: "en" | "pl"): string =>
    createHash("sha256")
      .update(readFileSync(join(args.out, `demo.${lang}.vtt`)))
      .digest("hex");
  rmSync(work, { recursive: true, force: true });

  print(`duration_seconds ${seconds.toFixed(1)}`);
  print(`size_bytes ${bytes}`);
  print(`sha256 ${sha256}`);
  // The owner pins all three files at G3 (`DEMO_VIDEO_SHA256`, `DEMO_CAPTION_SHA256` in `apps/docs/src/demo-video.ts`).
  print(`caption_sha256 en ${captionSha256("en")}`);
  print(`caption_sha256 pl ${captionSha256("pl")}`);
  const notLive = DEMO_STEPS.map((step) => stepView(step, source.kind))
    .filter((view) => !view.live)
    .map((view) => view.id);
  facts.notLive = notLive;
  print(`not_live ${notLive.join(",")}`);
  print(`files ${mp4} ${join(args.out, "demo.en.vtt")} ${join(args.out, "demo.pl.vtt")}`);
  const tooBig = videoProblem({ bytes, seconds });
  return tooBig === null ? 0 : fail(tooBig);
}

// The verdict is the last write of the run, whatever the exit path. The e2e seed holds no real triage: a video from it proves the
// command and is never a public video.
main()
  .catch((error) => fail(`demo_record_error ${error instanceof Error ? error.message : String(error)}`))
  .then((code) => {
    print(uploadVerdict({ ...facts, exitCode: code }));
    process.exit(code);
  });
