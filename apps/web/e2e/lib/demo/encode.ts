// The ffmpeg arguments of the demo encode: one fixed list, so a recording is the same file type on every machine.
// H.264 (libx264, crf 28, yuv420p) plays in every browser; `+faststart` lets it play before the download ends; `-an` drops audio.
export function ffmpegArgs(opts: { input: string; output: string; trimStartMs: number }): string[] {
  if (!Number.isFinite(opts.trimStartMs) || opts.trimStartMs < 0) throw new Error("encode_bad_trim");
  return [
    "-y",
    "-ss",
    (opts.trimStartMs / 1000).toFixed(3),
    "-i",
    opts.input,
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
