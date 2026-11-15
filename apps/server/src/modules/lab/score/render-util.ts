// Small helpers for the renderers of the report: number formats, a Markdown table, the typed section renderer.
import type { Interval } from "./triage";

// One renderer per section: a section stage adds its entry to `SECTION_RENDERERS` and its data under `LabScore.sections`.
export type SectionRenderer = (data: unknown) => string[];
export const section = <T>(render: (data: T) => string[]): SectionRenderer => render as SectionRenderer;

export const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)} %`);
export const num = (value: number | null): string => (value === null ? "n/a" : value.toFixed(4));
export const range = (interval: Interval | null): string =>
  interval === null ? "n/a" : `${pct(interval.lower)} to ${pct(interval.upper)}`;

export function table(head: string[], body: string[][]): string[] {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
}
