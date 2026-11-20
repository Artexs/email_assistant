// JUnit reader (Bun's reporter) and the suite path reader of the timing and coverage runs.

export interface JunitCase {
  file: string;
  line: number;
  name: string;
  classname: string;
  time: number;
  assertions: number;
  skipped: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

function attributes(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    map.set(match[1] as string, decodeXml(match[2] as string));
  }
  return map;
}

const TESTCASE = /<testcase((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;

export function parseJunit(xml: string): JunitCase[] {
  const cases: JunitCase[] = [];
  for (const match of xml.matchAll(TESTCASE)) {
    const attrs = attributes(match[1] as string);
    let skipped = false;
    if (match[2] !== "/") {
      const start = (match.index ?? 0) + match[0].length;
      const end = xml.indexOf("</testcase>", start);
      skipped = xml.slice(start, end === -1 ? xml.length : end).includes("<skipped");
    }
    cases.push({
      file: attrs.get("file") ?? "",
      line: Number(attrs.get("line") ?? 0),
      name: attrs.get("name") ?? "",
      classname: attrs.get("classname") ?? "",
      time: Number(attrs.get("time") ?? 0),
      assertions: Number(attrs.get("assertions") ?? 0),
      skipped,
    });
  }
  return cases;
}

// The path tokens of a `bun test <paths>` script: tokens after `bun test` that do not start with `-`.
export function suitePaths(script: string): string[] {
  const tokens = script.trim().split(/\s+/);
  const at = tokens.findIndex((token, index) => token === "bun" && tokens[index + 1] === "test");
  if (at === -1) return [];
  return tokens.slice(at + 2).filter((token) => !token.startsWith("-"));
}
