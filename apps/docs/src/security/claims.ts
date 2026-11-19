// The claims of the public security page (F121). Each claim cites rows of the claims ledger (`docs/legal/claims.md`)
// and repo files that prove it. `claimProblems` is the check; the build runs it (`integrations/claim-check.ts`).
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { Texts } from "@ea/core/web";
import { docsGitRef, REPO_URL } from "../in-place";

export interface PublicClaim {
  id: string;
  text: Texts;
  // Row ids of the ledger (`C018`).
  ledger: readonly string[];
  // Repo paths, relative to the repo root.
  proofs: readonly string[];
  // The condition under which the claim holds (the ledger's condition column); null when the cited rows have none.
  condition: Texts | null;
}

// Stage 02 fills the list. While it is empty the security page makes no claim.
export const publicClaims: readonly PublicClaim[] = [];

export interface LedgerRow {
  id: string;
  source: string;
  condition: string;
}

const LEDGER_ROW = /^\|\s*(C\d{3})\s*\|/;
const WEAK = /\b(?:gap|unverified)\b/i;
const NO_CONDITION = "—";

// The rows of the ledger table: `| C018 | claim | source | condition |`. A line of another shape is no row.
export function parseLedger(ledgerText: string): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  for (const line of ledgerText.split("\n")) {
    const id = LEDGER_ROW.exec(line)?.[1];
    if (id === undefined) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    rows.set(id, { id, source: cells[2] ?? "", condition: cells[3] ?? "" });
  }
  return rows;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Does the source cell name the path, its file name, or `ADR NNNN` for `docs/decisions/NNNN-*.md`?
function sourceNames(source: string, path: string): boolean {
  const names = [path, path.slice(path.lastIndexOf("/") + 1)];
  const adr = /^docs\/decisions\/(\d{4})-[^/]+\.md$/.exec(path)?.[1];
  const patterns = names.map((name) => `(?<![\\w./-])${escapeRegExp(name)}(?![\\w-]|\\.\\w)`);
  if (adr !== undefined) patterns.push(`\\bADR\\s+${adr}\\b`);
  return new RegExp(patterns.join("|")).test(source);
}

// A repo path that stays inside the root: not absolute, no `..`, no URL.
function isRepoPath(path: string): boolean {
  if (path === "" || isAbsolute(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** Each problem reads `claim <id> <reason>`. An empty list means every claim is proven. */
export function claimProblems(claims: readonly PublicClaim[], root: string, ledgerText: string): string[] {
  const ledger = parseLedger(ledgerText);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const problem = (reason: string) => problems.push(`claim ${claim.id} ${reason}`);
    if (seen.has(claim.id)) problem("duplicate_id");
    seen.add(claim.id);

    if (claim.ledger.length === 0) problem("no_ledger");
    const cited: LedgerRow[] = [];
    for (const rowId of claim.ledger) {
      const row = ledger.get(rowId);
      if (row === undefined) {
        problem(`ledger_missing ${rowId}`);
        continue;
      }
      if (WEAK.test(row.source)) problem(`ledger_weak ${rowId}`);
      cited.push(row);
    }

    if (claim.proofs.length === 0) problem("no_proof");
    for (const path of claim.proofs) {
      const inside = isRepoPath(path) && !relative(root, join(root, path)).startsWith("..");
      if (!inside || !existsSync(join(root, path))) {
        problem(`proof_missing ${path}`);
        continue;
      }
      if (!cited.some((row) => sourceNames(row.source, path))) problem(`proof_not_in_ledger ${path}`);
    }

    if (claim.condition === null && cited.some((row) => row.condition !== NO_CONDITION && row.condition !== "")) {
      problem("condition_missing");
    }
  }
  return problems;
}

/** The GitHub link of a proof file at `ref` (the tag of a deploy, else `master`). */
export function proofUrl(path: string, ref: string = docsGitRef()): string {
  return `${REPO_URL}/blob/${ref}/${path}`;
}
