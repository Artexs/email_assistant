import { registrableDomain, trustedAuthResults } from "./suspicious";

// Shared hosting suffixes. The built-in registrable-domain rule has no private suffixes, so `evil.github.io` would be
// "registrable" as `github.io` and a signature of `github.io` would align with every tenant. For these suffixes the
// registrable domain keeps one more label (`evil.github.io`).
const SHARED_SUFFIXES: ReadonlySet<string> = new Set([
  "github.io",
  "pages.dev",
  "vercel.app",
  "netlify.app",
  "blogspot.com",
  "herokuapp.com",
  "azurewebsites.net",
  "web.app",
  "firebaseapp.com",
  "onrender.com",
]);

function registrableWithShared(labels: string[]): string[] {
  const base = registrableDomain(labels.join(".")).split(".");
  if (!SHARED_SUFFIXES.has(base.join(".")) || labels.length <= base.length) return base;
  return labels.slice(-(base.length + 1));
}

// The domains from `fromDomain` up to its registrable domain: `a.b.c.example` gives `a.b.c.example`, `b.c.example`,
// `c.example`. A signing domain in this list is aligned with the From domain (relaxed, as DMARC reads it) and is never a
// public suffix or a shared hosting suffix.
function alignedDomains(fromDomain: string): string[] {
  const labels = fromDomain.trim().toLowerCase().replace(/\.+$/, "").split(".");
  const floor = registrableWithShared(labels).length;
  const found: string[] = [];
  for (let start = 0; labels.length - start >= floor; start += 1) found.push(labels.slice(start).join("."));
  return found;
}

// RFC 8601 lexing of an Authentication-Results value (already folded to lower case). A comment is `( ... )`, nests, and
// may hold `\` quoted pairs; a quoted string is `" ... "` with `\` quoted pairs. A comment becomes one space; a quoted
// string becomes the placeholder `"q"`, which is never a domain. So a `;` or a `dkim=pass` inside either cannot start or
// make a result. Folded lines are plain white space. null when the value is malformed (an open comment or quote, a stray
// `)`): the caller then trusts nothing.
function stripCommentsAndQuotes(text: string): string | null {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (depth > 0) {
      if (c === "\\") i += 1;
      else if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) out += " ";
      }
      continue;
    }
    if (c === "(") depth = 1;
    else if (c === ")") return null;
    else if (c === '"') {
      let closed = false;
      for (i += 1; i < text.length; i += 1) {
        const q = text.charAt(i);
        if (q === "\\") i += 1;
        else if (q === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) return null;
      out += '"q"';
    } else out += c;
  }
  return depth === 0 ? out : null;
}

// A `dkim=pass` result with `header.d` = the From domain or a parent of it (down to the registrable domain), read only
// when the authserv-id of the topmost `Authentication-Results` value is trusted. False for any other input. This does not
// prove that the signature covers the `List-Unsubscribe` headers, as RFC 8058 asks (accepted limit, F110 question 16).
export function hasTrustedAlignedDkimPass(
  authResults: string | null,
  trustedAuthservIds: readonly string[],
  fromDomain: string
): boolean {
  if (authResults === null || fromDomain.trim() === "") return false;
  // Lex the raw text: only the ASCII `;`, `(` and `"` of the header count. A full-width `；` is text, whatever NFKC makes of it.
  const lexed = stripCommentsAndQuotes(authResults.toLowerCase());
  if (lexed === null) return false;
  if (trustedAuthResults(lexed, trustedAuthservIds) === null) return false;
  const aligned = alignedDomains(fromDomain);
  // The first `;` part is the authserv-id. Each other part is one result; it is folded (NFKC) only after the split.
  for (const raw of lexed.split(";").slice(1)) {
    const part = raw.normalize("NFKC");
    if (!/^\s*dkim\s*=\s*pass(?!\S)/.test(part)) continue;
    const signer = /(?:^|\s)header\.d\s*=\s*([^\s;]+)/.exec(part)?.[1];
    if (signer !== undefined && aligned.includes(signer.replace(/\.+$/, ""))) return true;
  }
  return false;
}
