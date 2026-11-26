import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import { demoDbProblem } from "./db-guard";

// The arguments and the checks of `bun run demo:record`. Pure apart from the file checks, which a test fills with fakes.
// Every refusal is a short code; the command prints it and exits 1 before it starts a server or changes a database.
export const DEFAULT_OUT_DIR = "tmp/demo";
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
export const MIN_VIDEO_SECONDS = 100;
export const MAX_VIDEO_SECONDS = 130;

export interface RecordArgs {
  /** The demo seed file named with `--seed`, as an absolute path. Absent: the source rule of `shotSource()` decides. */
  seed: string | undefined;
  /** The output folder, as an absolute path. */
  out: string;
  /** `--setup-only`: set the demo organization up and check its state, with no recording. Needs `--seed`. */
  setupOnly: boolean;
}

// `--seed <file>`, `--out <dir>` and `--setup-only`, each at most once. Anything else is `bad_args <argument>`.
// `--setup-only` without `--seed` is `setup_only_needs_seed`: the setup works on a demo seed only.
export function parseRecordArgs(argv: readonly string[], cwd: string = process.cwd()): RecordArgs | string {
  const values: Record<string, string> = {};
  let setupOnly = false;
  for (let at = 0; at < argv.length; at += 1) {
    const key = argv[at] ?? "";
    if (key === "--setup-only" && !setupOnly) {
      setupOnly = true;
      continue;
    }
    const value = argv[at + 1];
    if ((key !== "--seed" && key !== "--out") || value === undefined || value === "" || key in values) {
      return `bad_args ${key}`.trim();
    }
    values[key] = value;
    at += 1;
  }
  const seed = values["--seed"];
  if (setupOnly && seed === undefined) return "setup_only_needs_seed";
  return {
    seed: seed === undefined ? undefined : resolve(cwd, seed),
    out: resolve(cwd, values["--out"] ?? DEFAULT_OUT_DIR),
    setupOnly,
  };
}

// Is `command` an existing file in one of the folders of the PATH value?
export function onPath(
  command: string,
  pathValue: string | undefined,
  exists: (path: string) => boolean = existsSync
): boolean {
  return (pathValue ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .some((dir) => exists(join(dir, command)));
}

export interface PreflightEnv {
  env: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
}

// The checks before any server starts, in this order: ffmpeg, a named seed file, the demo database keys, the demo database name.
// null: go on. A code: print it and exit 1.
export function preflightProblem(args: RecordArgs, { env, exists = existsSync }: PreflightEnv): string | null {
  if (!onPath("ffmpeg", env.PATH, exists)) return "ffmpeg_missing";
  if (args.seed !== undefined && !exists(args.seed)) return "seed_missing";
  const app = env.DEMO_DATABASE_URL;
  const migrator = env.DEMO_MIGRATOR_DATABASE_URL;
  if (app === undefined || app === "" || migrator === undefined || migrator === "") return "demo_db_missing";
  const others = [env.DATABASE_URL, env.MIGRATOR_DATABASE_URL, env.E2E_DATABASE_URL, env.E2E_MIGRATOR_DATABASE_URL];
  return demoDbProblem(app, others) ?? demoDbProblem(migrator, others);
}

// The size and length limits of the finished video (at most 15 MB; the script plans 116 s).
export function videoProblem(video: { bytes: number; seconds: number }): string | null {
  if (video.bytes > MAX_VIDEO_BYTES) return `video_too_large ${video.bytes}`;
  if (!(video.seconds >= MIN_VIDEO_SECONDS && video.seconds <= MAX_VIDEO_SECONDS)) {
    return `video_length ${video.seconds.toFixed(1)}`;
  }
  return null;
}

// The video is 1280 x 720. The page is larger (16:9, 1600 x 900) and Playwright scales its frames down: the connect dialog of the panel
// is taller than 720 px, and at that height its Connect button lies outside the page (the click then waits until the test times out).
export const DEMO_VIDEO_SIZE = { width: 1280, height: 720 } as const;
export const DEMO_VIEWPORT = { width: 1600, height: 900 } as const;
