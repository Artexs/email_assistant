import type { Db } from "../../platform/db";
import { divergentCodePoints, type DivergentCodePoint } from "../contacts";

export type AddressRuleCheck = { ok: true } | { ok: false; codePoints: number[] };

// The check runs on the database that serves the find or the erase, so it takes the same `Db` they take.
export type RuleCheck = (db: Db, address: string) => Promise<AddressRuleCheck>;

// The divergent code points of the database of this process, read once. One CLI run is one process, so a changed image
// shows at the next run. A failed read is not kept: the next call asks again.
let divergentOfProcess: Promise<DivergentCodePoint[]> | null = null;

function cachedDivergent(db: Db): Promise<DivergentCodePoint[]> {
  if (divergentOfProcess === null) {
    const pending = divergentCodePoints(db);
    divergentOfProcess = pending;
    pending.catch(() => {
      if (divergentOfProcess === pending) divergentOfProcess = null;
    });
  }
  return divergentOfProcess;
}

// The code points where the SQL form and the program form of the address rule differ and that matter for this address.
// The equality match is exact for the address when none does. A divergent code point conflicts when
// (a) its program form or its database form is a code point of the asked address (the database lowers less or more than
// the program), or (b) its program form is empty (the program trims it, the database does not).
// `address` is already in rule form. Ascending, as `divergent` is.
export function addressRuleConflicts(address: string, divergent: readonly DivergentCodePoint[]): number[] {
  const letters = new Set([...address].map((char) => char.codePointAt(0) as number));
  return divergent
    .filter(({ js, db }) => {
      if (js === "") return true;
      return [...js, ...db].some((char) => letters.has(char.codePointAt(0) as number));
    })
    .map(({ cp }) => cp);
}

export async function checkAddressRule(db: Db, address: string): Promise<AddressRuleCheck> {
  const codePoints = addressRuleConflicts(address, await cachedDivergent(db));
  return codePoints.length === 0 ? { ok: true } : { ok: false, codePoints };
}

const hexOf = (text: string): string =>
  text === "" ? "-" : [...text].map((char) => (char.codePointAt(0) as number).toString(16)).join(",");

// The lines of `org:dsr --rule-check`: the count, then one line per divergent code point. Code points only, no address.
// An empty form (a trim difference) shows as `-`.
export function formatRuleCheck(divergent: readonly DivergentCodePoint[]): string[] {
  return [
    `rule check ${divergent.length}`,
    ...divergent.map(
      ({ cp, js, db }) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")} js ${hexOf(js)} db ${hexOf(db)}`
    ),
  ];
}
