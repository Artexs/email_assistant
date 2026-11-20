import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

// The writing style of a drafter eval run (`--style`): the voice of the corpus executive, no style, or the text of a
// style file that the stylist eval wrote. The judge measures every run against the voice of the corpus executive.
export const STYLE_SCENARIO = "scenario";
export const STYLE_NONE = "none";

// The style file of the stylist eval (`evals/results/styles/`). Synthetic text only.
export const styleFileSchema = z.object({
  scenario: z.string(),
  part: z.string(),
  promptVersion: z.string().min(1),
  model: z.string(),
  effort: z.string().nullable(),
  sampleCount: z.number().int().nonnegative(),
  text: z.string(),
  checks: z.object({ ok: z.boolean(), failures: z.array(z.string()) }),
  usd: z.number(),
});

export type DrafterStyle =
  | { kind: "scenario"; key: typeof STYLE_SCENARIO }
  | { kind: "none"; key: typeof STYLE_NONE }
  | { kind: "file"; key: string; file: string; sampleCount: number; text: string };

// Why a style file cannot be used. The text names the file and the problem, never the style text.
export class StyleFileError extends Error {}

// The style key of a file is its prompt version and the start of the hash of its text, so two files of one prompt
// version never share a state file.
export function keyOfFile(promptVersion: string, text: string): string {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 8);
  return `${promptVersion.replace(/[^\w.-]/g, "_")}-${hash}`;
}

export function loadStyle(option: string | undefined): DrafterStyle {
  if (option === undefined || option === STYLE_SCENARIO) return { kind: "scenario", key: STYLE_SCENARIO };
  if (option === STYLE_NONE) return { kind: "none", key: STYLE_NONE };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(option, "utf8"));
  } catch {
    throw new StyleFileError(`style file ${option} cannot be read as JSON`);
  }
  const parsed = styleFileSchema.safeParse(json);
  if (!parsed.success) throw new StyleFileError(`style file ${option} has no valid style file shape`);
  const file = parsed.data;
  if (!file.checks.ok) {
    throw new StyleFileError(`style file ${option} failed its checks (${file.checks.failures.join(", ")}): not used`);
  }
  return {
    kind: "file",
    key: keyOfFile(file.promptVersion, file.text),
    file: option,
    sampleCount: file.sampleCount,
    text: file.text,
  };
}

// The part of the state file name, the report title and the ledger label that names the style. The default style adds
// nothing, so the names of the runs before `--style` stay.
export function styleSuffix(style: DrafterStyle): string {
  return style.kind === "scenario" ? "" : `-style-${style.key}`;
}

// The writing style the drafter gets; the corpus voice for the default.
export function writingStyleOf(style: DrafterStyle, voice: string): string | null {
  if (style.kind === "scenario") return voice;
  return style.kind === "none" ? null : style.text;
}

// The style line of the report: the key, and for a file its path and the number of mails it came from.
export function styleHeader(style: DrafterStyle): { key: string; file: string | null; sampleCount: number | null } {
  return style.kind === "file"
    ? { key: style.key, file: style.file, sampleCount: style.sampleCount }
    : { key: style.key, file: null, sampleCount: null };
}
