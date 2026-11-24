import type { ReactNode } from "react";

// One section of the pattern page. Each file in `sections/` exports one as `section`.
export interface PatternSection {
  title: string;
  order: number;
  render: () => ReactNode;
}

export interface LoadedSection extends PatternSection {
  // The file name without its extension: the `id` of the heading and the anchor of the section.
  id: string;
}

// Sorts by `order`, then by `title`. Returns a new array.
export function orderSections<T extends { order: number; title: string }>(sections: readonly T[]): T[] {
  return [...sections].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

// Turns the result of `import.meta.glob("./sections/*.tsx", { eager: true })` into sections. A file with no `section` export
// stops the page with `no section export: <file name>`; a section file that is not listed anywhere is never silently skipped.
export function loadSections(modules: Record<string, unknown>): LoadedSection[] {
  const loaded = Object.entries(modules).map(([path, module]) => {
    const file = path.split("/").pop() ?? path;
    const section = (module as { section?: PatternSection } | null)?.section;
    if (section === undefined) throw new Error(`no section export: ${file}`);
    return { ...section, id: file.replace(/\.[^.]+$/, "") };
  });
  return orderSections(loaded);
}
