import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_FILES, DEMO_MAX_BYTES, DEMO_VIDEO_SHA256 } from "../src/demo-video";
import { type Downloader, main } from "./demo-fetch";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("demo-fetch", () => {
  let dir = "";
  let printed: string[] = [];
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "demo-fetch-")), "demo");
    printed = [];
    spyOn(console, "log").mockImplementation((...args: unknown[]) => void printed.push(args.join(" ")));
    spyOn(console, "error").mockImplementation((...args: unknown[]) => void printed.push(args.join(" ")));
  });
  afterEach(() => {
    rmSync(join(dir, ".."), { recursive: true, force: true });
    spyOn(console, "log").mockRestore();
    spyOn(console, "error").mockRestore();
  });

  // A fake `gh release download`: it writes the files of the release into the folder.
  const releaseOf =
    (files: Record<string, string>, calls: string[] = []): Downloader =>
    async (to) => {
      calls.push(to);
      for (const [name, text] of Object.entries(files)) writeFileSync(join(to, name), text);
    };
  const full = (video: string): Record<string, string> => ({
    "demo.mp4": video,
    "demo.en.vtt": "WEBVTT\n",
    "demo.pl.vtt": "WEBVTT\n",
  });

  test("the committed pin is null: no pin, no download", () => {
    expect(DEMO_VIDEO_SHA256).toBeNull();
  });

  test("T4 a null pin: no download call, exit 0, `demo_video off`", async () => {
    const calls: string[] = [];
    expect(await main(dir, releaseOf(full("x"), calls), null)).toBe(0);
    expect(calls).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    expect(printed.join("\n")).toContain("demo_video off");
  });

  test("T4 a file of another hash exits 1 with demo_video_hash", async () => {
    expect(await main(dir, releaseOf(full("other")), sha("video"))).toBe(1);
    expect(printed.join("\n")).toContain("demo_video_hash");
  });

  test("T4 a matching file exits 0 and the files stay", async () => {
    expect(await main(dir, releaseOf(full("video")), sha("video"))).toBe(0);
    for (const name of DEMO_FILES) expect(existsSync(join(dir, name))).toBe(true);
    expect(printed.join("\n")).toContain("demo_video on");
  });

  test("a pin in capital letters still matches", async () => {
    expect(await main(dir, releaseOf(full("video")), sha("video").toUpperCase())).toBe(0);
  });

  test("a failed download exits 1 (a pinned video must be there)", async () => {
    const missingRelease: Downloader = async () => {
      throw new Error("gh_release_download_failed");
    };
    expect(await main(dir, missingRelease, sha("video"))).toBe(1);
    expect(printed.join("\n")).toContain("demo_video_download");
  });

  test("a missing caption file exits 1 and names it", async () => {
    const rest = full("video");
    delete rest["demo.pl.vtt"];
    expect(await main(dir, releaseOf(rest), sha("video"))).toBe(1);
    expect(printed.join("\n")).toContain("demo_video_missing demo.pl.vtt");
  });

  test("an unknown file of the release exits 1", async () => {
    expect(await main(dir, releaseOf({ ...full("video"), "demo.zip": "z" }), sha("video"))).toBe(1);
    expect(printed.join("\n")).toContain("demo_video_extra demo.zip");
  });

  test("a file over 20 MB exits 1 before the hash is read", async () => {
    const big = "a".repeat(DEMO_MAX_BYTES + 1);
    expect(await main(dir, releaseOf({ ...full("video"), "demo.en.vtt": big }), sha("video"))).toBe(1);
    expect(printed.join("\n")).toContain("demo_video_size demo.en.vtt");
  });

  test("an old file in the folder is removed before the download", async () => {
    await main(dir, releaseOf({ ...full("video"), "old.txt": "x" }), sha("video"));
    expect(await main(dir, releaseOf(full("video")), sha("video"))).toBe(0);
    expect(existsSync(join(dir, "old.txt"))).toBe(false);
  });
});
