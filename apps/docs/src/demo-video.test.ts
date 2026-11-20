import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEMO_CAPTION_SHA256,
  DEMO_FILES,
  DEMO_TEXTS,
  demoFilesExist,
  demoVideoView,
  DEMO_VIDEO_SHA256,
} from "./demo-video";
import { flaggedTextProblems } from "./flagged-text";

describe("demoVideoView", () => {
  test("no file, no view: nothing renders", () => {
    expect(demoVideoView("en", false)).toBeNull();
    expect(demoVideoView("pl", false)).toBeNull();
  });

  test("two caption tracks, the page language first and the only default", () => {
    for (const lang of ["en", "pl"] as const) {
      const view = demoVideoView(lang, true);
      expect(view?.tracks.map((track) => track.srclang)).toEqual(lang === "en" ? ["en", "pl"] : ["pl", "en"]);
      expect(view?.tracks.filter((track) => track.default).map((track) => track.srclang)).toEqual([lang]);
      expect(view?.src).toBe("/email_assistant/demo/demo.mp4");
      expect(view?.note).toBe(DEMO_TEXTS[lang].note);
    }
  });

  test("the pin is null until the owner uploaded a video", () => {
    expect(DEMO_VIDEO_SHA256).toBeNull();
  });

  test("the three pins are all null or all a sha256 in lowercase hex", () => {
    const pins = [DEMO_VIDEO_SHA256, DEMO_CAPTION_SHA256.en, DEMO_CAPTION_SHA256.pl];
    if (pins.every((pin) => pin === null)) return;
    for (const pin of pins) expect(pin).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the line under the video holds no string of a default-off flag, in both languages", () => {
    for (const lang of ["en", "pl"] as const) {
      expect(flaggedTextProblems(DEMO_TEXTS[lang].note)).toEqual([]);
      expect(flaggedTextProblems(DEMO_TEXTS[lang].label)).toEqual([]);
    }
  });
});

describe("demoFilesExist", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "demo-files-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("all three files are needed", () => {
    expect(demoFilesExist(join(dir, "missing"))).toBe(false);
    mkdirSync(join(dir, "demo"));
    for (const name of DEMO_FILES.slice(0, 2)) writeFileSync(join(dir, "demo", name), "x");
    expect(demoFilesExist(join(dir, "demo"))).toBe(false);
    writeFileSync(join(dir, "demo", DEMO_FILES[2] as string), "x");
    expect(demoFilesExist(join(dir, "demo"))).toBe(true);
  });
});
