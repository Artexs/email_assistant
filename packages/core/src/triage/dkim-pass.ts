import { registrableDomain, trustedAuthResults } from "./suspicious";

// The domains from `fromDomain` up to its registrable domain: `a.b.c.example` gives `a.b.c.example`, `b.c.example`,
// `c.example`. A signing domain in this list is aligned with the From domain (relaxed, as DMARC reads it) and is never a
// public suffix.
function alignedDomains(fromDomain: string): string[] {
  const labels = fromDomain.trim().toLowerCase().replace(/\.+$/, "").split(".");
  const floor = registrableDomain(labels.join(".")).split(".").length;
  const found: string[] = [];
  for (let start = 0; labels.length - start >= floor; start += 1) found.push(labels.slice(start).join("."));
  return found;
}

// A `dkim=pass` result with `header.d` = the From domain or a parent of it (down to the registrable domain), read only
// when the authserv-id of the topmost `Authentication-Results` value is trusted. False for any other input. This does not
// prove that the signature covers the `List-Unsubscribe` headers, as RFC 8058 asks (accepted limit, F110 question 16).
export function hasTrustedAlignedDkimPass(
  authResults: string | null,
  trustedAuthservIds: readonly string[],
  fromDomain: string
): boolean {
  const results = trustedAuthResults(authResults, trustedAuthservIds);
  if (results === null || fromDomain.trim() === "") return false;
  const aligned = alignedDomains(fromDomain);
  // Each result of the value is one `;` part. A comment in parentheses is not part of the result.
  for (const part of results.split(";")) {
    const clean = part.replace(/\([^)]*\)/g, " ");
    if (!/^\s*dkim\s*=\s*pass(?![a-z])/.test(clean)) continue;
    const signer = /(?:^|\s)header\.d\s*=\s*([^\s;]+)/.exec(clean)?.[1];
    if (signer !== undefined && aligned.includes(signer.replace(/\.+$/, ""))) return true;
  }
  return false;
}
