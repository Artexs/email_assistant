import { dkimCoversOneClickHeaders, type DkimSignature } from "./dkim-signature";
import { registrableDomainShared, trustedAuthResults } from "./suspicious";

// The domains from `fromDomain` up to its registrable domain: `a.b.c.example` gives `a.b.c.example`, `b.c.example`,
// `c.example`. A signing domain in this list is aligned with the From domain (relaxed, as DMARC reads it) and is never a
// public suffix or a shared hosting suffix.
function alignedDomains(fromDomain: string): string[] {
  const labels = fromDomain.trim().toLowerCase().replace(/\.+$/, "").split(".");
  const floor = registrableDomainShared(labels.join(".")).split(".").length;
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

// The `header.d` values (lower case, no trailing dot) of the `dkim=pass` results with `header.d` = the From domain or a
// parent of it (down to the registrable domain), read only when the authserv-id of the topmost `Authentication-Results`
// value is trusted. Empty for any other input.
function trustedAlignedPassDomains(
  authResults: string | null,
  trustedAuthservIds: readonly string[],
  fromDomain: string
): string[] {
  if (authResults === null || fromDomain.trim() === "") return [];
  // Lex the raw text: only the ASCII `;`, `(` and `"` of the header count. A full-width `；` is text, whatever NFKC makes of it.
  const lexed = stripCommentsAndQuotes(authResults.toLowerCase());
  if (lexed === null) return [];
  if (trustedAuthResults(lexed, trustedAuthservIds) === null) return [];
  const aligned = alignedDomains(fromDomain);
  const found: string[] = [];
  // The first `;` part is the authserv-id. Each other part is one result; it is folded (NFKC) only after the split.
  for (const raw of lexed.split(";").slice(1)) {
    const part = raw.normalize("NFKC");
    if (!/^\s*dkim\s*=\s*pass(?!\S)/.test(part)) continue;
    const signer = /(?:^|\s)header\.d\s*=\s*([^\s;]+)/.exec(part)?.[1]?.replace(/\.+$/, "");
    if (signer !== undefined && aligned.includes(signer)) found.push(signer);
  }
  return found;
}

// RFC 8058 asks that the signature covers `List-Unsubscribe` and `List-Unsubscribe-Post`. The trusted server verified
// one signature and named its domain in `header.d`; it did not say which signature header it was, and a replayer can
// add signature headers of the same domain. So the proof is this: there is a trusted aligned `dkim=pass`, and EVERY
// signature header of that domain in the mail (`signatures`, from `dkimSignaturesOf`) names both headers in `h=`. Then
// the verified one covers them, whichever it is. `null` (a mail stored before the signatures were captured) or no
// signature of the domain gives false.
export function hasCoveredDkimPass(
  authResults: string | null,
  trustedAuthservIds: readonly string[],
  fromDomain: string,
  signatures: readonly DkimSignature[] | null
): boolean {
  if (signatures === null) return false;
  return trustedAlignedPassDomains(authResults, trustedAuthservIds, fromDomain).some((domain) => {
    const ofDomain = signatures.filter((signature) => signature.d === domain);
    return ofDomain.length > 0 && ofDomain.every((signature) => dkimCoversOneClickHeaders(signature.h));
  });
}
