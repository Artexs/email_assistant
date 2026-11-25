// The docs text check: a panel text that a docs page quotes through `<UiText k="key" />` must still be read by the panel.
// A key that no panel file reads would survive in `en.ts` only because the docs page names it, and the page would quote a text
// that the panel no longer shows. The check is pure; the test reads the real files.
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface DocsOnlyKey {
  readonly key: string;
  readonly file: string;
}

const UI_TEXT_KEY = /<UiText\s+k=(?:"([^"]+)"|'([^']+)')/g;

// The keys that a docs file reads through a `UiText` tag, each once.
export function docsKeys(text: string): string[] {
  return [...new Set([...text.matchAll(UI_TEXT_KEY)].map((match) => match[1] ?? match[2] ?? ""))];
}

// A docs key is in the panel when its name stands as a whole word in a panel file, or it begins with a run-time prefix.
// One result per key and docs file, sorted by file, then key.
export function docsOnlyKeys(
  docsFiles: readonly SourceFile[],
  panelFiles: readonly SourceFile[],
  prefixes: readonly { prefix: string }[]
): DocsOnlyKey[] {
  const panelWords = new Set(panelFiles.flatMap((file) => file.text.match(/\w+/g) ?? []));
  const found: DocsOnlyKey[] = [];
  for (const file of docsFiles) {
    for (const key of docsKeys(file.text)) {
      if (panelWords.has(key) || prefixes.some((entry) => key.startsWith(entry.prefix))) continue;
      found.push({ key, file: file.path });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key));
}

// The failure text of one result.
export function docsOnlyMessage(entry: DocsOnlyKey): string {
  return `docs_key_not_in_panel ${entry.key} ${entry.file}`;
}
