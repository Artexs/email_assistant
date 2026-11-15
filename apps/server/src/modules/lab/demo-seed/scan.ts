import { normalizeDsrAddress } from "../../privacy";

import type { DemoRow } from "./tables";

// Which values may leave the lab (rule of F113 stage 15). Every address in a seed ends in `.test`; every mailbox host
// is the sim GreenMail (a loopback name) or a `.test` name. The scan reads every string of every row, so an address in
// a subject, a body, a header, a JSON payload or an audit row is found. Findings name the table and column only.

// A word with an `@` inside. The same characters that `normalizeDsrAddress` of the privacy module refuses (white space,
// quotes, angle brackets) end the word, so `<a@x.test>`, `"a@x.test"` and `a@x.test.` find the address inside.
const CANDIDATE = /[^\s<>,;"'()[\]{}\\@]+@[^\s<>,;"'()[\]{}\\@]+/g;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const isTestHost = (host: string): boolean => host === "test" || host.endsWith(".test");

/** True when the text holds a word that looks like an address and its domain is not `.test`. */
export function hasNonTestAddress(text: string): boolean {
  for (const match of text.matchAll(CANDIDATE)) {
    // A full stop at the end is the end of a sentence, not of the domain.
    const word = match[0].replace(/[.:!?]+$/, "");
    const address = normalizeDsrAddress(word);
    // A word that looks like an address but is not a valid one is refused too: the rule errs on the side of refusing.
    if (address === null) return true;
    if (!isTestHost(address.slice(address.indexOf("@") + 1))) return true;
  }
  return false;
}

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
