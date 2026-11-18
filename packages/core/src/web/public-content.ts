// The public-content check of a built text file. A public site must show no private data and load no
// third-party asset. Used by the docs build (`apps/docs/integrations/public-content.ts`) and, later, by the screenshot run.
// Pure text work: no Node module (browser-safe folder). Each rule runs on the raw text and on the text with HTML tags removed.
import { DOCS_ORIGIN } from "../site";

export interface PublicContentProblem {
  rule: string;
  match: string;
}

export interface PublicContentScan {
  problems: PublicContentProblem[];
  // The allow-list entries that let at least one match pass.
  used: string[];
}

const MAIL_DOMAIN_SUFFIXES = [".example", ".test", ".invalid", ".localhost"];
const MAIL_DOMAINS = ["example.com", "example.net", "example.org"];

const stripTags = (text: string): string => text.replace(/<[^>]*>/g, "");

const matches = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((m) => m[0]);

// R1: a host under ts.net that has a real label in front. `<machine>.<tailnet>.ts.net` (also HTML-escaped) has none.
const r1TailnetHost = (text: string): string[] => matches(text, /(?:[a-z0-9-]+\.)+ts\.net\b/gi);

// R2: a mail address on a real domain.
function r2MailAddress(text: string): string[] {
  return matches(text, /[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi).filter((address) => {
    const domain = address.slice(address.indexOf("@") + 1).toLowerCase();
    if (/^\d+x\./.test(domain)) return false; // an image name such as `logo@2x.png`
    if (MAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
    return !MAIL_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix));
  });
}

function ipv4Allowed(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets;
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (octets.every((o) => o === 0)) return true;
  return (
    (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
  );
}

// R3: an IPv4 address in 100.64.0.0/10, or a public one outside the three documentation nets.
function r3Ipv4(text: string): string[] {
  return matches(text, /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)/g).filter((address) => {
    const octets = address.split(".").map(Number);
    return octets.every((o) => o <= 255) && !ipv4Allowed(octets);
  });
}

const isExternal = (url: string): boolean => {
  const value = url.trim();
  if (value === DOCS_ORIGIN || value.startsWith(`${DOCS_ORIGIN}/`)) return false;
  return /^(?:https?:)?\/\//i.test(value);
};

const TAG_ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))`, "i").exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

// R4: a `src`, a `srcset` candidate, a stylesheet, preload, modulepreload or icon link, or a CSS `url(` that points to another origin.
function r4ExternalAsset(text: string): string[] {
  const urls: string[] = [];
  for (const m of text.matchAll(/\b(src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)) {
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (m[1]?.toLowerCase() === "srcset") {
      for (const candidate of value.split(",")) urls.push(candidate.trim().split(/\s+/)[0] ?? "");
    } else urls.push(value);
  }
  for (const m of text.matchAll(new RegExp(`<link\\b${TAG_ATTRIBUTES}>`, "gi"))) {
    const rel = (attribute(m[1] ?? "", "rel") ?? "").toLowerCase().split(/\s+/);
    if (["stylesheet", "preload", "modulepreload", "icon"].some((r) => rel.includes(r))) {
      urls.push(attribute(m[1] ?? "", "href") ?? "");
    }
  }
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi)) {
    urls.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return urls.filter(isExternal);
}

const r5Form = (text: string): string[] => matches(text, /<form\b/gi);
const r6Tracking = (text: string): string[] =>
  matches(text, /document\.cookie|gtag\(|googletagmanager|plausible|umami|posthog|segment\.com/gi);
const r7Competitor = (text: string): string[] => matches(text, /inbox zero|fyxer|superhuman|shortwave|sanebox/gi);

const RULES: readonly (readonly [string, (text: string) => string[]])[] = [
  ["R1", r1TailnetHost],
  ["R2", r2MailAddress],
  ["R3", r3Ipv4],
  ["R4", r4ExternalAsset],
  ["R5", r5Form],
  ["R6", r6Tracking],
  ["R7", r7Competitor],
];

// Every problem of one text, each (rule, match) once. A match that equals an allow-list string passes.
export function publicContentScan(text: string, allow: readonly string[]): PublicContentScan {
  const allowed = new Set(allow);
  const used = new Set<string>();
  const seen = new Set<string>();
  const problems: PublicContentProblem[] = [];
  for (const variant of [text, stripTags(text)]) {
    for (const [rule, find] of RULES) {
      for (const match of find(variant)) {
        if (allowed.has(match)) {
          used.add(match);
          continue;
        }
        const key = `${rule}\u0000${match}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({ rule, match });
      }
    }
  }
  return { problems, used: [...used] };
}

export function publicContentProblems(text: string, allow: readonly string[]): PublicContentProblem[] {
  return publicContentScan(text, allow).problems;
}

// The allow file: one `<exact string> | <reason>` per line; blank lines and `#` comment lines are skipped.
export function parseAllowList(text: string): string[] {
  const entries: string[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const cut = line.indexOf(" | ");
    const entry = cut < 0 ? "" : line.slice(0, cut).trim();
    const reason = cut < 0 ? "" : line.slice(cut + 3).trim();
    if (entry === "" || reason === "") throw new Error(`allow_entry_invalid line ${index + 1}`);
    entries.push(entry);
  });
  return entries;
}
