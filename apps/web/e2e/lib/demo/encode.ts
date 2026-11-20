import type { DemoCue } from "./steps";

// The cut of the demo video: the steps stay, the time between two steps (the product working off camera) goes.
// A gap of this length or more between two cues is cut; a shorter gap stays, so a page change has no jump cut.
export const CUT_GAP_MS = 1000;

export interface CutSegment {
  startMs: number;
  endMs: number;
}

// The kept segments of the raw recording, and the cues on the cut timeline (the first cue starts at 0).
// Cues must be in order and must not overlap; a cue that ends when it starts or before is bad too.
export function cutPlan(cues: readonly DemoCue[]): { segments: CutSegment[]; cues: DemoCue[] } {
  const first = cues[0];
  if (first === undefined) throw new Error("encode_no_cues");
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs <= cue.startMs) {
      throw new Error(`encode_bad_cues ${cue.stepId}`);
    }
    if (cue.startMs < previousEnd) throw new Error(`encode_bad_cues ${cue.stepId}`);
    previousEnd = cue.endMs;
  }

  const segments: CutSegment[] = [];
  const shifted: DemoCue[] = [];
  // Raw time that a cut removed before the current cue.
  let removedMs = first.startMs;
  let segmentStart = first.startMs;
  let segmentEnd = first.startMs;
  for (const cue of cues) {
    const gap = cue.startMs - segmentEnd;
    if (gap >= CUT_GAP_MS) {
      segments.push({ startMs: segmentStart, endMs: segmentEnd });
      removedMs += gap;
      segmentStart = cue.startMs;
    }
    shifted.push({ stepId: cue.stepId, startMs: cue.startMs - removedMs, endMs: cue.endMs - removedMs });
    segmentEnd = cue.endMs;
  }
  segments.push({ startMs: segmentStart, endMs: segmentEnd });
  return { segments, cues: shifted };
}

const seconds = (ms: number): string => (ms / 1000).toFixed(3);

// The ffmpeg arguments of the demo encode: one fixed list, so a recording is the same file type on every machine.
// The kept segments are trimmed from the one input and joined in one pass (`trim`, `concat`); no audio (`-an`).
// H.264 (libx264, crf 28, yuv420p) plays in every browser; `+faststart` lets it play before the download ends.
export function ffmpegArgs(opts: { input: string; output: string; segments: readonly CutSegment[] }): string[] {
  const { segments } = opts;
  if (segments.length === 0) throw new Error("encode_no_segments");
  for (const segment of segments) {
    if (
      !Number.isFinite(segment.startMs) ||
      !Number.isFinite(segment.endMs) ||
      segment.startMs < 0 ||
      segment.endMs <= segment.startMs
    ) {
      throw new Error("encode_bad_segment");
    }
  }
  const trims = segments.map(
    (segment, index) =>
      `[0:v]trim=start=${seconds(segment.startMs)}:end=${seconds(segment.endMs)},setpts=PTS-STARTPTS[v${index}]`
  );
  const joined = `${segments.map((_, index) => `[v${index}]`).join("")}concat=n=${segments.length}:v=1:a=0[v]`;
  return [
    "-y",
    "-i",
    opts.input,
    "-filter_complex",
    [...trims, joined].join(";"),
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
    opts.output,
  ];
}
