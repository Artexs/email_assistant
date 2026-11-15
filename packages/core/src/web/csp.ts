// The Content-Security-Policy check of a built page, shared by the panel (`apps/web/integrations/csp-style-src.ts`)
// and the docs site (`apps/docs/integrations/csp-finalize.ts`). Pure text work: no Node module (browser-safe folder).
import { sha256Base64 } from "./sha256";

export type CspProblem =
  | "csp_meta_count" // not exactly one <meta http-equiv="content-security-policy"> (case-insensitive)
  | "no_default_src" // no directive exactly "default-src 'self'"
  | "no_script_src" // no directive named "script-src"
  | "script_src_unsafe_inline" // script-src, script-src-elem or script-src-attr holds 'unsafe-inline'
  | "unsafe_eval" // any directive holds 'unsafe-eval'
  | "style_src_not_relaxed" // no directive exactly "style-src 'self' 'unsafe-inline'"
  | "style_src_split" // a style-src-elem or style-src-attr directive exists (it overrides the relaxed style-src)
  | "script_hash_missing"; // an inline <script> whose sha256 is not in the script source list

export type DocsCspProblem = CspProblem | `docs_directive_missing ${string}`;

export const STYLE_DIRECTIVE = "style-src 'self' 'unsafe-inline'";

// What a docs page must carry on top of the panel's CSP: no plugin, no <base> hijack, no form target, no fetch target.
export const DOCS_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "connect-src 'self'",
] as const;

const CSP_META_TAG = /<meta\b[^>]*\bhttp-equiv="content-security-policy"[^>]*>/gi;
const META_CONTENT = /\bcontent="([^"]*)"/i;
const SCRIPT_DIRECTIVES = new Set(["script-src", "script-src-elem", "script-src-attr"]);
const STYLE_SPLIT_DIRECTIVES = new Set(["style-src-elem", "style-src-attr"]);
// An opening tag whose attribute values may hold ">" inside quotes; the capture is the attribute text.
const SCRIPT_ELEMENT = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;

export interface CspDirective {
  text: string;
  name: string;
}

export function parseDirectives(content: string): CspDirective[] {
  return content
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((text) => ({ text, name: text.split(/\s+/)[0] ?? "" }));
}

// The content of the single CSP meta of a page, or null when the page has none or more than one.
export function cspMetaContent(html: string): string | null {
  const metas = html.match(CSP_META_TAG) ?? [];
  if (metas.length !== 1) return null;
  return META_CONTENT.exec(metas[0])?.[1] ?? "";
}

// The exact text of every inline script (a <script> without src), in page order.
export function inlineScripts(html: string): string[] {
  const texts: string[] = [];
  for (const match of html.matchAll(SCRIPT_ELEMENT)) {
    if (!SRC_ATTRIBUTE.test(match[1] ?? "")) texts.push(match[2] ?? "");
  }
  return texts;
}

export function scriptHashSource(text: string): string {
  return `'sha256-${sha256Base64(text)}'`;
}

const hasToken = (text: string, token: string) => text.split(/\s+/).includes(token);

// Returns the first problem of one built page, or null when the page carries the CSP.
export function cspProblem(html: string): CspProblem | null {
  const content = cspMetaContent(html);
  if (content === null) return "csp_meta_count";
  const directives = parseDirectives(content);

  if (!directives.some((d) => d.text === "default-src 'self'")) return "no_default_src";
  if (!directives.some((d) => d.name === "script-src")) return "no_script_src";
  if (directives.some((d) => SCRIPT_DIRECTIVES.has(d.name) && hasToken(d.text, "'unsafe-inline'"))) {
    return "script_src_unsafe_inline";
  }
  if (directives.some((d) => hasToken(d.text, "'unsafe-eval'"))) return "unsafe_eval";
  if (!directives.some((d) => d.text === STYLE_DIRECTIVE)) return "style_src_not_relaxed";
  if (directives.some((d) => STYLE_SPLIT_DIRECTIVES.has(d.name))) return "style_src_split";

  // A script element is governed by script-src-elem when it exists, else by script-src.
  const governing =
    directives.find((d) => d.name === "script-src-elem") ?? directives.find((d) => d.name === "script-src");
  const allowed = new Set(governing?.text.split(/\s+/) ?? []);
  if (inlineScripts(html).some((text) => !allowed.has(scriptHashSource(text)))) return "script_hash_missing";
  return null;
}

// `cspProblem`, then the directives of a docs page.
export function docsCspProblem(html: string): DocsCspProblem | null {
  const problem = cspProblem(html);
  if (problem) return problem;
  const directives = parseDirectives(cspMetaContent(html) ?? "");
  for (const required of DOCS_DIRECTIVES) {
    if (!directives.some((d) => d.text === required)) return `docs_directive_missing ${required.split(" ")[0]}`;
  }
  return null;
}
