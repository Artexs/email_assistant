// The deploy build downloads the demo video before `docs:build` (`.github/workflows/docs-deploy.yml`, step "Download the pinned demo video").
// `DEMO_VIDEO_SHA256` (`../src/demo-video.ts`) is null: the script prints `demo_video off`, downloads nothing and exits 0.
// A pin is set: it downloads the assets of the release `demo-video` into `apps/docs/public/demo` with the `gh` CLI (`GH_TOKEN` is the run's
// read-only `github.token`), and exits 1 when a file is missing or over 20 MB, when an unknown file came with them, or when the sha256 of
// `demo.mp4` or of a caption file is not its pin (`DEMO_CAPTION_SHA256`; a null caption pin next to a video pin is an error). The owner pinned a
// video, so a site without it is an error, not a skip. The public-content check of the build also reads the caption files.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import type { UserLocale } from "@ea/core";

import { createCliOutput } from "../../server/src/platform/cli";
import {
  DEMO_CAPTION_FILES,
  DEMO_CAPTION_SHA256,
  DEMO_FILES,
  DEMO_MAX_BYTES,
  DEMO_RELEASE_TAG,
  DEMO_VIDEO_FILE,
  DEMO_VIDEO_SHA256,
} from "../src/demo-video";

const EXIT_OK = 0;
const EXIT_PROBLEM = 1;

// Puts the files of the release into `dir`. It throws when the release or the download fails.
export type Downloader = (dir: string) => Promise<void>;

// `gh release download demo-video --pattern 'demo*' --dir <dir>`; no `--clobber` (the folder is emptied first).
export function ghDownloader(env: Readonly<Record<string, string | undefined>> = process.env): Downloader {
  return async (dir) => {
    const repo = env.GITHUB_REPOSITORY;
    const args = [
      "gh",
      "release",
      "download",
      DEMO_RELEASE_TAG,
      "--pattern",
      "demo*",
      "--dir",
      dir,
      ...(repo !== undefined && repo !== "" ? ["--repo", repo] : []),
    ];
    const run = Bun.spawn(args, { env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
    if ((await run.exited) !== 0) throw new Error("gh_release_download_failed");
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// The first problem of the downloaded folder as `demo_video_<reason> <detail>`, or null.
export function demoFolderProblem(
  dir: string,
  pin: string,
  captionPins: Readonly<Record<UserLocale, string | null>> = DEMO_CAPTION_SHA256
): string | null {
  const present = readdirSync(dir).sort();
  const missing = DEMO_FILES.find((name) => !present.includes(name));
  if (missing !== undefined) return `demo_video_missing ${missing}`;
  const extra = present.find((name) => !DEMO_FILES.includes(name));
  if (extra !== undefined) return `demo_video_extra ${extra}`;
  const big = DEMO_FILES.find((name) => statSync(join(dir, name)).size > DEMO_MAX_BYTES);
  if (big !== undefined) return `demo_video_size ${big}`;
  const pinned: [string, string | null][] = [
    [DEMO_VIDEO_FILE, pin],
    [DEMO_CAPTION_FILES.en, captionPins.en],
    [DEMO_CAPTION_FILES.pl, captionPins.pl],
  ];
  for (const [name, hash] of pinned) {
    if (hash === null) return `demo_video_pin_missing ${name}`;
    if (sha256File(join(dir, name)) !== hash.toLowerCase()) return `demo_video_hash ${name}`;
  }
  return null;
}

export async function main(
  dir: string,
  download: Downloader,
  pin: string | null = DEMO_VIDEO_SHA256,
  captionPins: Readonly<Record<UserLocale, string | null>> = DEMO_CAPTION_SHA256
): Promise<number> {
  const out = createCliOutput("demo-fetch");
  if (pin === null) {
    out.print("demo_video off");
    return EXIT_OK;
  }
  // The folder is the script's own (git-ignored): an old file would make `gh` fail without `--clobber`.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    await download(dir);
  } catch {
    out.fail("demo_video_download");
    return EXIT_PROBLEM;
  }
  const problem = demoFolderProblem(dir, pin, captionPins);
  if (problem !== null) {
    out.fail(problem);
    return EXIT_PROBLEM;
  }
  out.print("demo_video on");
  return EXIT_OK;
}

if (import.meta.main) {
  process.exit(await main(join(import.meta.dir, "../public/demo"), ghDownloader()));
}
