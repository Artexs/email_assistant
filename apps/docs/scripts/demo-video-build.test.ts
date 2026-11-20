import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { docsCspProblem } from "@ea/core/web";

// The home pages built without and with the demo video files. Each build reads its own public folder (`EA_DOCS_PUBLIC_DIR`),
// so the real `public/demo` of a developer and `dist` stay as they were. The files are the committed fixtures: a 1 s black video, never played here.
const DOCS = join(import.meta.dir, "..");
const FIXTURES = join(DOCS, "e2e/fixtures");
const WORK_ROOT = join(DOCS, ".dist-demo-video-test");
setDefaultTimeout(150_000);

const FIXTURE_FILES: Record<string, string> = {
  "demo.mp4": "demo-1s.mp4",
  "demo.en.vtt": "demo-1s.en.vtt",
  "demo.pl.vtt": "demo-1s.pl.vtt",
};

function build(withVideo: boolean): string {
  const run = mkdtempSync(join(WORK_ROOT, "run-"));
  const publicDir = join(run, "public");
  mkdirSync(join(publicDir, "demo"), { recursive: true });
  copyFileSync(join(DOCS, "public/favicon.svg"), join(publicDir, "favicon.svg"));
  if (withVideo)
    for (const [name, fixture] of Object.entries(FIXTURE_FILES))
      copyFileSync(join(FIXTURES, fixture), join(publicDir, "demo", name));
  const out = join(run, "dist");
  const result = Bun.spawnSync(["bun", "run", "build", "--outDir", out], {
    cwd: DOCS,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DOCS_SHOTS: undefined,
      EA_DOCS_SHOTS_DIR: undefined,
      EA_DOCS_DEMO_DIR: undefined,
      EA_DOCS_PUBLIC_DIR: publicDir,
    },
    timeout: 140_000,
  });
  if (result.exitCode !== 0)
    throw new Error(`docs build failed:\n${result.stdout.toString()}${result.stderr.toString()}`);
  return out;
}

let without = "";
let withFiles = "";
const home = (dist: string, lang: "en" | "pl"): string =>
  readFileSync(join(dist, lang === "pl" ? "pl" : "", "index.html"), "utf8");

beforeAll(() => {
  mkdirSync(WORK_ROOT, { recursive: true });
  without = build(false);
  withFiles = build(true);
});
afterAll(() => rmSync(WORK_ROOT, { recursive: true, force: true }));

describe("the demo video on the built home pages", () => {
  test("1. a build without the files has no <video> and no note, in both languages", () => {
    for (const lang of ["en", "pl"] as const) {
      const html = home(without, lang);
      expect(html).not.toContain("<video");
      expect(html).not.toContain("demo-video");
      expect(html).not.toContain("made-up data");
    }
    expect(existsSync(join(without, "demo/demo.mp4"))).toBe(false);
  });

  test("2. a build with the fixture files has a <video> with two caption tracks, and the CSP check passes", () => {
    for (const lang of ["en", "pl"] as const) {
      const html = home(withFiles, lang);
      expect(html.match(/<video\b/g)).toHaveLength(1);
      const video = /<video\b[^>]*>/.exec(html)?.[0] ?? "";
      expect(video).toContain("controls");
      expect(video).toContain('preload="metadata"');
      expect(video).toContain("playsinline");
      expect(video).not.toContain("autoplay");
      const tracks = [...html.matchAll(/<track\b[^>]*>/g)].map((match) => match[0]);
      expect(tracks).toHaveLength(2);
      for (const track of tracks) expect(track).toContain('kind="captions"');
      expect(tracks.filter((track) => /\bdefault\b/.test(track))).toHaveLength(1);
      expect(tracks.find((track) => /\bdefault\b/.test(track))).toContain(`srclang="${lang}"`);
      expect(video).toContain('src="/email_assistant/demo/demo.mp4"');
      expect(html).toContain(lang === "en" ? "made-up data" : "dane wymyślone");
      // The build itself ran this check on every page (`ea-csp-finalize`); the explicit call names it.
      expect(docsCspProblem(html)).toBeNull();
    }
    for (const name of Object.keys(FIXTURE_FILES)) expect(existsSync(join(withFiles, "demo", name))).toBe(true);
  });

  test("the CSP needs no media-src: default-src 'self' covers the video and the tracks", () => {
    expect(home(withFiles, "en")).not.toContain("media-src");
  });
});
