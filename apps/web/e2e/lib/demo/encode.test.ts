import { describe, expect, test } from "bun:test";

import { cutPlan, ffmpegArgs } from "./encode";

const cue = (startMs: number, endMs: number, stepId = "connect") => ({ stepId, startMs, endMs });

describe("cutPlan", () => {
  test("cuts the lead-in and a long gap, and moves the cues onto the cut timeline", () => {
    expect(cutPlan([cue(1000, 15000, "a"), cue(15200, 27000, "b"), cue(90000, 108000, "c")])).toEqual({
      segments: [
        { startMs: 1000, endMs: 27000 },
        { startMs: 90000, endMs: 108000 },
      ],
      cues: [cue(0, 14000, "a"), cue(14200, 26000, "b"), cue(26000, 44000, "c")],
    });
  });

  test("keeps a gap of 999 ms and cuts a gap of 1000 ms", () => {
    expect(cutPlan([cue(0, 5000), cue(5999, 9000)]).segments).toEqual([{ startMs: 0, endMs: 9000 }]);
    expect(cutPlan([cue(0, 5000), cue(6000, 9000)]).segments).toEqual([
      { startMs: 0, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ]);
  });

  test("throws on cues that overlap, an empty cue and an empty list", () => {
    expect(() => cutPlan([cue(0, 5000), cue(4000, 8000)])).toThrow("encode_bad_cues");
    expect(() => cutPlan([cue(0, 5000), cue(7000, 7000)])).toThrow("encode_bad_cues");
    expect(() => cutPlan([])).toThrow("encode_no_cues");
  });
});

describe("ffmpegArgs", () => {
  test("trims and joins the segments in one pass with the fixed codec settings", () => {
    expect(
      ffmpegArgs({
        input: "a.webm",
        output: "b.mp4",
        segments: [
          { startMs: 1000, endMs: 27000 },
          { startMs: 90000, endMs: 108000 },
        ],
      })
    ).toEqual([
      "-y",
      "-i",
      "a.webm",
      "-filter_complex",
      "[0:v]trim=start=1.000:end=27.000,setpts=PTS-STARTPTS[v0];[0:v]trim=start=90.000:end=108.000,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
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

  test("refuses no segment and a bad segment", () => {
    expect(() => ffmpegArgs({ input: "a", output: "b", segments: [] })).toThrow("encode_no_segments");
    expect(() => ffmpegArgs({ input: "a", output: "b", segments: [{ startMs: -1, endMs: 5 }] })).toThrow(
      "encode_bad_segment"
    );
    expect(() => ffmpegArgs({ input: "a", output: "b", segments: [{ startMs: 5, endMs: 5 }] })).toThrow(
      "encode_bad_segment"
    );
  });
});
