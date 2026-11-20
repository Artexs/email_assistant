// lcov reader and the hit-line union of the cut proof.

export interface FileCoverage {
  found: number;
  hit: number;
  hitLines: Set<number>;
}

const isTestFile = (path: string): boolean => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

// Keyed by the source path as lcov prints it (repo-relative for Bun). Test files are dropped.
export function parseLcov(text: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  let path: string | null = null;
  let current: FileCoverage | null = null;
  let lf: number | null = null;
  let lh: number | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      path = line.slice(3);
      current = { found: 0, hit: 0, hitLines: new Set() };
      lf = null;
      lh = null;
    } else if (current !== null && line.startsWith("DA:")) {
      const [lineNo, count] = line.slice(3).split(",");
      if (Number(count) > 0) current.hitLines.add(Number(lineNo));
    } else if (current !== null && line.startsWith("LF:")) {
      lf = Number(line.slice(3));
    } else if (current !== null && line.startsWith("LH:")) {
      lh = Number(line.slice(3));
    } else if (line === "end_of_record" && current !== null && path !== null) {
      current.found = lf ?? current.found;
      current.hit = lh ?? current.hitLines.size;
      if (!isTestFile(path)) files.set(path, current);
      path = null;
      current = null;
    }
  }
  return files;
}

// Per source file the union of the hit lines of two reports. `found` takes the larger value.
export function unionHits(a: Map<string, FileCoverage>, b: Map<string, FileCoverage>): Map<string, FileCoverage> {
  const out = new Map<string, FileCoverage>();
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const left = a.get(path);
    const right = b.get(path);
    const hitLines = new Set([...(left?.hitLines ?? []), ...(right?.hitLines ?? [])]);
    out.set(path, { found: Math.max(left?.found ?? 0, right?.found ?? 0), hit: hitLines.size, hitLines });
  }
  return out;
}
