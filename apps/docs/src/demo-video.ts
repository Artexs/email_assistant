// The demo video on the home page (decision: the video is an asset of the GitHub release `demo-video`, never in git).
// `<DemoVideo lang />` (`components/DemoVideo.astro`) shows it only when the three files stand in `apps/docs/public/demo/` at build.
// The deploy puts them there only when `DEMO_VIDEO_SHA256` names the video (`scripts/demo-fetch.ts`).
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DOCS_BASE, type UserLocale } from "@ea/core";

// The sha256 (lowercase hex) of `demo.mp4` that the owner pinned, or null: no pin means no download and no video on the site.
// Only the coordinator sets it, after the owner uploaded the video (owner gate G3). An upload with `--clobber` cannot change the site
// without a commit that changes this value.
export const DEMO_VIDEO_SHA256: string | null = null;
// The sha256 of each caption file, pinned with the video: the captions are public text on the home page, so an upload with `--clobber`
// must not change them without a commit either. All three pins are null or all three are set (`demo-video.test.ts`).
export const DEMO_CAPTION_SHA256: Record<UserLocale, string | null> = { en: null, pl: null };

export const DEMO_VIDEO_FILE = "demo.mp4";
export const DEMO_CAPTION_FILES: Record<UserLocale, string> = { en: "demo.en.vtt", pl: "demo.pl.vtt" };
export const DEMO_FILES: readonly string[] = [DEMO_VIDEO_FILE, DEMO_CAPTION_FILES.en, DEMO_CAPTION_FILES.pl];
// The release that holds the files, and the largest file the deploy accepts.
export const DEMO_RELEASE_TAG = "demo-video";
export const DEMO_MAX_BYTES = 20 * 1024 * 1024;

// The visible texts. The note is a fact about the demo organization (the flagged-text test checks it holds no string of a default-off flag).
export const DEMO_TEXTS: Record<UserLocale, { label: string; note: string; langLabel: Record<UserLocale, string> }> = {
  en: {
    label: "Demo video",
    note: "The demo organization is made-up data and has every feature on; some features are off by default.",
    langLabel: { en: "English", pl: "Polish" },
  },
  pl: {
    label: "Film demonstracyjny",
    note: "Organizacja demo to dane wymyślone i ma włączone wszystkie funkcje; część funkcji jest domyślnie wyłączona.",
    langLabel: { en: "angielski", pl: "polski" },
  },
};

export function demoUrl(name: string): string {
  return `${DOCS_BASE}/demo/${name}`;
}

// `EA_DOCS_DEMO_DIR` points the build at another folder (tests only); the integration `ea-demo-video` sets the real one.
export function demoDir(env: Record<string, string | undefined> = process.env): string {
  const dir = env.EA_DOCS_DEMO_DIR;
  if (dir === undefined || dir === "") throw new Error("demo_dir_unset");
  return dir;
}

// True when the video and both caption files stand in the folder.
export function demoFilesExist(dir: string = demoDir()): boolean {
  return DEMO_FILES.every((name) => existsSync(join(dir, name)));
}

export interface DemoVideoView {
  label: string;
  note: string;
  src: string;
  // The page language comes first and is the default track.
  tracks: { src: string; srclang: UserLocale; label: string; default: boolean }[];
}

// What `<DemoVideo lang />` shows, or null (render nothing, no empty box) when a file is missing.
export function demoVideoView(lang: UserLocale, exists: boolean): DemoVideoView | null {
  if (!exists) return null;
  const texts = DEMO_TEXTS[lang];
  const order: UserLocale[] = lang === "pl" ? ["pl", "en"] : ["en", "pl"];
  return {
    label: texts.label,
    note: texts.note,
    src: demoUrl(DEMO_VIDEO_FILE),
    tracks: order.map((code) => ({
      src: demoUrl(DEMO_CAPTION_FILES[code]),
      srclang: code,
      label: texts.langLabel[code],
      default: code === lang,
    })),
  };
}
