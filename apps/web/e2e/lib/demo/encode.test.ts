import { describe, expect, test } from "bun:test";

import { ffmpegArgs } from "./encode";

describe("ffmpegArgs", () => {
  test("is the fixed list with the trim in seconds", () => {
    expect(ffmpegArgs({ input: "a.webm", output: "b.mp4", trimStartMs: 2500 })).toEqual([
      "-y",
      "-ss",
      "2.500",
      "-i",
      "a.webm",
      "-c:v",
      "libx264",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      "b.mp4",
    ]);
  });

  test("refuses a negative or non-finite trim", () => {
    expect(() => ffmpegArgs({ input: "a", output: "b", trimStartMs: -1 })).toThrow("encode_bad_trim");
    expect(() => ffmpegArgs({ input: "a", output: "b", trimStartMs: Number.NaN })).toThrow("encode_bad_trim");
  });
});
