// Evidence guard. A probe row gives a string; this module decides if the string may go into the result file.
// The rule is a block list of token shapes plus a length rule, and it refuses any `@`: an address is never evidence.

export type RefusalRule =
  | "not-a-string"
  | "too-long"
  | "jwt"
  | "google-access-token"
  | "google-refresh-token"
  | "microsoft-refresh-token"
  | "microsoft-access-token"
  | "long-token-run"
  | "address"
  | "known-secret";

const RULES: readonly { rule: RefusalRule; pattern: RegExp }[] = [
  { rule: "jwt", pattern: /eyJ/ },
  { rule: "google-access-token", pattern: /ya29\./ },
  { rule: "google-refresh-token", pattern: /1\/\// },
  // A Microsoft refresh token starts `M.C` as a value, so the match starts at a word edge ("IMAP.C" is not a token).
  { rule: "microsoft-refresh-token", pattern: /\bM\.C/ },
  { rule: "microsoft-access-token", pattern: /EwB/ },
  { rule: "long-token-run", pattern: /[A-Za-z0-9_-]{40,}/ },
  { rule: "address", pattern: /@/ },
];

const MAX_EVIDENCE_LENGTH = 2000;

/** The message names the rule only. It never holds the refused text, so it is safe to print. */
export class EvidenceRefusal extends Error {
  readonly rule: RefusalRule;

  constructor(rule: RefusalRule) {
    super(`evidence refused by rule ${rule}`);
    this.name = "EvidenceRefusal";
    this.rule = rule;
  }
}

export function assertSafeEvidence(evidence: unknown): asserts evidence is string {
  if (typeof evidence !== "string") throw new EvidenceRefusal("not-a-string");
  if (evidence.length > MAX_EVIDENCE_LENGTH) throw new EvidenceRefusal("too-long");
  for (const { rule, pattern } of RULES) {
    if (pattern.test(evidence)) throw new EvidenceRefusal(rule);
  }
}

const MIN_SECRET_LENGTH = 6;

/** Refuse evidence that holds the exact value of a secret the run knows. A secret shorter than 6 characters is skipped. */
export function assertNoKnownSecret(evidence: string, secrets: readonly (string | undefined)[]): void {
  for (const secret of secrets) {
    if (secret !== undefined && secret.length >= MIN_SECRET_LENGTH && evidence.includes(secret)) {
      throw new EvidenceRefusal("known-secret");
    }
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace each known address, and its plus forms, with `<owner>`. A defence: a row builds evidence without addresses. */
export function maskAddresses(text: string, addresses: readonly string[]): string {
  let masked = text;
  for (const address of addresses) {
    const at = address.lastIndexOf("@");
    if (at < 1) continue;
    const local = escapeRegExp(address.slice(0, at).split("+")[0] ?? "");
    const domain = escapeRegExp(address.slice(at + 1));
    masked = masked.replace(new RegExp(`${local}(?:\\+[^@\\s]*)?@${domain}`, "gi"), "<owner>");
  }
  return masked;
}

const SAFE_WORD = /^[A-Za-z0-9_. -]{1,40}$/;

/** A short server word (an error code, a status) that is safe to quote. Anything else becomes `?`. */
export const word = (value: unknown): string => (typeof value === "string" && SAFE_WORD.test(value) ? value : "?");

const CAPABILITY = /^[A-Za-z0-9_.=+-]{1,40}$/;
const FOLDER = /^[\p{L}\p{N}[\]/._ -]{1,80}$/u;

/** An IMAP capability name such as `AUTH=XOAUTH2`. Anything else becomes `?`. */
export const capability = (value: unknown): string =>
  typeof value === "string" && CAPABILITY.test(value) ? value : "?";

/** A folder path such as `[Gmail]/Sent Mail` or `Wysłane`. A path with other characters becomes `?`. */
export const folderPath = (value: unknown): string => {
  if (typeof value !== "string" || !FOLDER.test(value)) return "?";
  // A long run of name characters looks like a token, so a long name is cut. The result is at most 40 characters.
  return value.replace(/[A-Za-z0-9_-]{31,}/g, (run) => `${run.slice(0, 30)}...`).slice(0, 40);
};
