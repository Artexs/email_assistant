import { splitAddress } from "./address";

// Suspicious-mail rules (F109, PD-063). One pure function: the reasons for one mail, from fields the
// caller already holds. No DB, no network. The caller decides who is a known sender (stage 03).

export const suspiciousReasons = [
  "auth_fail",
  "lookalike_domain",
  "display_name_spoof",
  "reply_to_mismatch",
  "link_mismatch",
  "risky_attachment",
] as const;
export type SuspiciousReason = (typeof suspiciousReasons)[number];

export interface SuspiciousInput {
  fromAddress: string;
  fromName: string | null;
  replyTo: string[];
  authResults: string | null;
  trustedAuthservIds: string[];
  links: { host: string; textHost: string | null }[];
  attachments: { name: string | null; type: string }[];
  isList: boolean; // List-Id or List-Unsubscribe
  senderKnown: boolean;
  knownDomains: string[];
  protectedNames: string[];
}

// A free-mail domain never makes a sender known by its domain (plan D4).
export const freeMailDomains: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "interia.pl",
  "interia.eu",
  "poczta.fm",
  "wp.pl",
  "o2.pl",
  "onet.pl",
  "op.pl",
  "gazeta.pl",
  "tlen.pl",
  "proton.me",
  "protonmail.com",
  "gmx.de",
  "gmx.net",
  "web.de",
];

// Plan D3: a built-in list of two-level suffixes, not a public-suffix library.
const TWO_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  "com.pl",
  "net.pl",
  "org.pl",
  "edu.pl",
  "gov.pl",
  "info.pl",
  "biz.pl",
  "waw.pl",
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "co.jp",
  "com.br",
  "co.nz",
  "co.za",
]);

const RISKY_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe",
  "scr",
  "bat",
  "cmd",
  "com",
  "pif",
  "js",
  "jse",
  "vbs",
  "vbe",
  "wsf",
  "hta",
  "ps1",
  "msi",
  "jar",
  "lnk",
  "iso",
  "img",
  "docm",
  "xlsm",
  "pptm",
  "dotm",
  "xlam",
]);

const RISKY_TYPES: ReadonlySet<string> = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/java-archive",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-word.document.macroenabled.12",
]);

// ---------------------------------------------------------------------------------------------
// Punycode (RFC 3492), decode only. No Node import.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 22; // 0-9 -> 26-35
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 97; // a-z
  return -1;
}

// Returns null on malformed input; the caller keeps the label as it is.
function punycodeDecode(input: string): string | null {
  const basicEnd = input.lastIndexOf("-");
  const output: number[] = [];
  for (let i = 0; i < Math.max(basicEnd, 0); i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x80) return null;
    output.push(code);
  }

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let pos = basicEnd > 0 ? basicEnd + 1 : 0;
  while (pos < input.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit < 0) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff) return null;
    output.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...output);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Folding

function foldLabel(label: string): string {
  if (!label.startsWith("xn--")) return label;
  const decoded = punycodeDecode(label.slice(4));
  return decoded === null ? label : decoded.normalize("NFKC").toLowerCase();
}

// Lower case, NFKC, `xn--` labels decoded, no trailing dot.
function foldHost(host: string): string {
  const folded = host.trim().normalize("NFKC").toLowerCase().replace(/\.+$/, "");
  return folded.split(".").map(foldLabel).join(".");
}

export function registrableDomain(host: string): string {
  const labels = foldHost(host).split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function domainOfAddress(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim();
  return domain === "" ? null : registrableDomain(domain);
}

// ---------------------------------------------------------------------------------------------
// Look-alike domains

// Cyrillic and Greek letters that look Latin (folded, lower case). Not the full UTS #39 table.
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  һ: "h",
  ӏ: "l",
  ԛ: "q",
  ԝ: "w",
  к: "k",
  м: "m",
  т: "t",
  н: "h",
  в: "b",
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  ω: "w",
  "0": "o",
  "1": "l",
};

function skeleton(domain: string): string {
  let mapped = "";
  for (const char of domain) {
    if (char === "-") continue;
    const latin = CONFUSABLES[char] ?? char;
    mapped += latin === "i" ? "l" : latin;
  }
  return mapped.replaceAll("rn", "m").replaceAll("vv", "w");
}

// Damerau-Levenshtein distance is exactly 1: one substitution, insertion, deletion or adjacent swap.
function isOneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  if (a.length === b.length) {
    // One substitution, or two swapped neighbours.
    if (a.slice(start + 1) === b.slice(start + 1)) return true;
    return a[start] === b[start + 1] && a[start + 1] === b[start] && a.slice(start + 2) === b.slice(start + 2);
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.slice(start) === longer.slice(start + 1);
}

const MIN_LABEL_LENGTH = 5;

function isLookalike(senderDomain: string, knownDomains: string[]): boolean {
  const known = knownDomains.map(registrableDomain);
  if (known.includes(senderDomain)) return false;

  const senderLabel = senderDomain.split(".")[0] ?? "";
  const senderSkeleton = skeleton(senderDomain);
  for (const other of known) {
    if (skeleton(other) === senderSkeleton) return true;
    const otherLabel = other.split(".")[0] ?? "";
    if (
      senderLabel.length >= MIN_LABEL_LENGTH &&
      otherLabel.length >= MIN_LABEL_LENGTH &&
      isOneEditApart(senderLabel, otherLabel)
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Other rules

const AUTH_FAIL_DMARC = /(?:^|[\s;(])dmarc\s*=\s*fail(?![a-z])/;
const AUTH_FAIL_SPF = /(?:^|[\s;(])spf\s*=\s*fail(?![a-z])/;
const AUTH_FAIL_DKIM = /(?:^|[\s;(])dkim\s*=\s*fail(?![a-z])/;

function isAuthFail(authResults: string | null, trusted: string[]): boolean {
  if (authResults === null) return false;
  const folded = authResults.normalize("NFKC").toLowerCase();
  const semicolon = folded.indexOf(";");
  if (semicolon < 0) return false;

  const id = folded.slice(0, semicolon).trim().split(/\s+/)[0] ?? "";
  if (id === "") return false;
  const trustedIds = trusted.map((entry) => entry.trim().toLowerCase().replace(/\.+$/, "")).filter((e) => e !== "");
  if (!trustedIds.some((entry) => id === entry || id.endsWith(`.${entry}`))) return false;

  const results = folded.slice(semicolon);
  return AUTH_FAIL_DMARC.test(results) || (AUTH_FAIL_SPF.test(results) && AUTH_FAIL_DKIM.test(results));
}

function isRiskyAttachment(attachment: { name: string | null; type: string }): boolean {
  const type = attachment.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (RISKY_TYPES.has(type)) return true;
  const name = attachment.name?.trim().toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 && RISKY_EXTENSIONS.has(name.slice(dot + 1));
}

const ADDRESS_IN_TEXT = /[^\s<>@"',;()]+@[^\s<>@"',;()]+\.[^\s<>@"',;()]+/;

// Diacritics removed, single spaces, lower case.
function foldName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replaceAll("ł", "l")
    .replaceAll("đ", "d")
    .replaceAll("ø", "o")
    .replace(/\s+/g, " ")
    .trim();
}

function isDisplayNameSpoof(fromAddress: string, fromName: string | null, protectedNames: string[]): boolean {
  if (fromName === null) return false;
  const inName = ADDRESS_IN_TEXT.exec(fromName.normalize("NFKC"));
  if (inName && inName[0].toLowerCase().replace(/[.]+$/, "") !== fromAddress.normalize("NFKC").trim().toLowerCase()) {
    return true;
  }

  const folded = foldName(fromName);
  if (folded === "") return false;
  return protectedNames.some((entry) => {
    const protectedName = foldName(entry);
    return protectedName.split(" ").length >= 2 && protectedName === folded;
  });
}

function isReplyToMismatch(fromAddress: string, replyTo: string[]): boolean {
  const fromDomain = domainOfAddress(fromAddress);
  if (fromDomain === null) return false;
  return replyTo.some((value) => {
    const domain = domainOfAddress(splitAddress(value).address);
    return domain !== null && domain !== fromDomain;
  });
}

function isLinkMismatch(links: SuspiciousInput["links"]): boolean {
  return links.some(
    (link) => link.textHost !== null && registrableDomain(link.textHost) !== registrableDomain(link.host)
  );
}

/** The suspicious reasons of one mail, in `suspiciousReasons` order, no duplicates. */
export function assessSuspicious(input: SuspiciousInput): SuspiciousReason[] {
  const reasons: SuspiciousReason[] = [];
  const senderDomain = domainOfAddress(input.fromAddress);

  if (isAuthFail(input.authResults, input.trustedAuthservIds)) reasons.push("auth_fail");

  // A known sender gets only `auth_fail` and `risky_attachment` (plan D1).
  if (!input.senderKnown) {
    if (senderDomain !== null && isLookalike(senderDomain, input.knownDomains)) reasons.push("lookalike_domain");
    if (isDisplayNameSpoof(input.fromAddress, input.fromName, input.protectedNames)) {
      reasons.push("display_name_spoof");
    }
    if (!input.isList && isReplyToMismatch(input.fromAddress, input.replyTo)) reasons.push("reply_to_mismatch");
    if (!input.isList && isLinkMismatch(input.links)) reasons.push("link_mismatch");
  }

  if (input.attachments.some(isRiskyAttachment)) reasons.push("risky_attachment");
  return reasons;
}
