export interface SheetEntry {
  state: string;
  name: string;
  viewport: "phone" | "desktop";
  scheme: "light" | "dark";
  locale: "en" | "pl";
  file: string;
  overflow: boolean;
}

const VIEWPORTS = ["phone", "desktop"] as const;
const SCHEMES = ["light", "dark"] as const;
const LOCALES = ["en", "pl"] as const;

// The order of the pictures inside one section: phone and desktop of the light scheme in English first, then the same in Polish, then dark.
function rank(entry: SheetEntry): number {
  return SCHEMES.indexOf(entry.scheme) * 4 + LOCALES.indexOf(entry.locale) * 2 + VIEWPORTS.indexOf(entry.viewport);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// One page for a person who scrolls: a section for each route, its pictures in a fixed order, a mark for a route that scrolls sideways.
// No script and no remote asset: the file opens from the disk.
export function sheetIndexHtml(entries: readonly SheetEntry[]): string {
  const sections = new Map<string, SheetEntry[]>();
  for (const entry of entries) {
    const key = `${entry.state}/${entry.name}`;
    sections.set(key, [...(sections.get(key) ?? []), entry]);
  }
  const body = [...sections.values()].map((group) => {
    const first = group[0];
    const mark = group.some((entry) => entry.overflow) ? `<strong class="overflow">overflow at 320 px</strong>` : "";
    const pictures = [...group]
      .sort((a, b) => rank(a) - rank(b))
      .map((entry) => {
        const label = `${entry.viewport} ${entry.scheme} ${entry.locale}`;
        return `<figure><img src="${escapeHtml(entry.file)}" alt="${escapeHtml(`${first.name} ${label}`)}" loading="lazy"><figcaption>${label}</figcaption></figure>`;
      })
      .join("");
    return `<section><h2>${escapeHtml(first.name)} <small>${escapeHtml(first.state)}</small> ${mark}</h2><div class="row">${pictures}</div></section>`;
  });
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><title>Contact sheet</title>`,
    `<style>body{font-family:sans-serif;margin:1rem}section{margin-bottom:2rem}.row{display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start}`,
    `figure{margin:0}img{max-height:480px;border:1px solid #888}.overflow{color:#a00}small{color:#666;font-weight:normal}</style></head>`,
    `<body><h1>Contact sheet</h1>${body.join("")}</body></html>`,
  ].join("\n");
}
