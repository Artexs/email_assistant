import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadRepoDotEnv } from "../../../server/src/scripts/e2e-job-env-args";
import { cutPlan, ffmpegArgs } from "../lib/demo/encode";
import { parseRecordArgs, preflightProblem, videoProblem } from "../lib/demo/record-args";
import { shotSource, type ShotSource } from "../lib/shot-source";
import { DEMO_STEPS, stepView, toVtt, type DemoCue } from "../lib/demo/steps";
import { resetDemoDb } from "./db-reset";

// `bun run demo:record [--seed <file>] [--out <dir>]`: records the demo video on the e2e servers and the demo database, then encodes it.
//
// 1. Checks, before any server starts or any database changes: ffmpeg, a named seed file, the demo database keys and name.
// 2. Rebuilds the demo database (drop every object, `db:migrate`), so a second run starts from the same state.
// 3. Runs `demo.config.ts` (Playwright): servers, seed, the eight steps in one recorded page; it writes the raw video and the cue times.
// 4. Encodes `demo.mp4` (`cutPlan`: only the steps stay; the lead-in and every gap of 1 s or more between two steps are cut), writes
//    `demo.en.vtt` and `demo.pl.vtt` with the cue times on the cut timeline, and prints the duration, the size and the sha256 of `demo.mp4` and of both caption files (the owner pins the three hashes when the video goes public).
// Exit 1 on a refusal, a failed run, an MP4 over 15 MB, or a length outside 100 to 130 seconds. Run it under
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

  const work = join(args.out, ".work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    DEMO_WORK_DIR: work,
    ...(source.kind === "demo" ? { DEMO_SEED_FILE: source.file } : {}),
  };

  print("rebuilding the demo database");
  await resetDemoDb(migratorUrl);
  const migrated = await run(["bun", "run", "db:migrate"], { ...env, MIGRATOR_DATABASE_URL: migratorUrl });
  if (migrated.code !== 0) return fail("demo_db_migrate_failed");

  const recorded = await run(["bunx", "playwright", "test", "-c", "apps/web/e2e/demo/demo.config.ts"], env);
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
  print(
    `not_live ${DEMO_STEPS.map((step) => stepView(step, source.kind))
      .filter((view) => !view.live)
      .map((view) => view.id)
      .join(",")}`
  );
  print(`files ${mp4} ${join(args.out, "demo.en.vtt")} ${join(args.out, "demo.pl.vtt")}`);
  // The e2e seed holds no real triage: a video from it is a proof of the command, never a public video.
  if (source.kind === "e2e") print("demo_source e2e: not for upload");
  const tooBig = videoProblem({ bytes, seconds });
  return tooBig === null ? 0 : fail(tooBig);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.exit(fail(`demo_record_error ${error instanceof Error ? error.message : String(error)}`));
  });
