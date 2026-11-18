import type { DemoRow } from "./tables";

// Which values may leave the lab. Every address in a seed ends in `.test`; every mailbox host
// is the sim GreenMail (a loopback name) or a `.test` name. The scan reads every string of every row, so an address in
// a subject, a body, a header, a JSON payload or an audit row is found. Findings name the table and column only.
//
// The scan keys on each `@` and the run of domain characters after it, not on the word before it (review B1: a quoted
// local part `"john"@gmail.com` and an address literal `john@[10.0.0.1]` have no plain word before the `@`). Every `@`
// must be followed by a domain of letters, digits, hyphens and dots that ends in `.test`; an empty run, a `[`, a
// non-ASCII letter or any other domain refuses. So a bare `@` in a text is refused too: lab text has none.
// Before the scan the text is normalized (NFKC: a full-width `＠` becomes `@`; format characters such as a zero-width
// space are removed) and the encoded forms of `@` are decoded (`%40`, `&#64;`, `&#x40;`, `&commat;`), up to three times
// (`%2540`, `&amp;#64;`).

// The characters that end a domain run. `[` is not one of them: the check refuses an `@[` before it reads a run.
const DOMAIN_END = /[\s<>,;"'()\]{}\\@/?#:!|]/;
const TEST_DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.test$/;
const ENCODED = [
  [/%25/gi, "%"],
  [/&amp;/gi, "&"],
  [/%40|&#0*64;|&#x0*40;|&commat;/gi, "@"],
] as const;

const normalize = (text: string): string => {
  let current = text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase();
  for (let round = 0; round < 3; round += 1) {
    const next = ENCODED.reduce((acc, [pattern, plain]) => acc.replace(pattern, plain), current);
    if (next === current) break;
    current = next;
  }
  return current;
};

export const isTestHost = (host: string): boolean => host === "test" || host.endsWith(".test");

/** True when the text holds an `@` that is not followed by a `.test` domain. */
export function hasNonTestAddress(text: string): boolean {
  const flat = normalize(text);
  let at = flat.indexOf("@");
  while (at !== -1) {
    const rest = flat.slice(at + 1);
    const end = rest.search(DOMAIN_END);
    // A full stop at the end is the end of a sentence, not of the domain.
    const domain = (end === -1 ? rest : rest.slice(0, end)).replace(/\.+$/, "");
    if (!TEST_DOMAIN.test(domain)) return true;
    at = flat.indexOf("@", at + 1);
  }
  return false;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function stringsOf(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, into);
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      stringsOf(item, into);
    }
  }
}

/** The first column (in row order) with an address outside `.test`, or undefined. */
export function findNonTestAddress(rows: readonly DemoRow[]): string | undefined {
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      const texts: string[] = [];
      stringsOf(value, texts);
      if (texts.some(hasNonTestAddress)) return column;
    }
  }
  return undefined;
}

/** The first mailbox host column that is not a loopback name or a `.test` name. */
export function findRealHost(mailboxes: readonly DemoRow[]): string | undefined {
  for (const row of mailboxes) {
    for (const column of ["imap_host", "smtp_host"]) {
      const host = row[column];
      if (typeof host !== "string") return column;
      const lower = host.toLowerCase();
      if (!LOOPBACK_HOSTS.has(lower) && !isTestHost(lower)) return column;
    }
  }
  return undefined;
}
